/**
 * Rules of `transactional.ts` that the histories of one process do not reach: two runtimes on one database, and what
 * a caller or a launcher gives that the runtime refuses. Each test runs on SQLite and on PostgreSQL.
 */
import { expect, test } from 'bun:test'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Scope from 'effect/Scope'
import { SqlClient } from 'effect/sql'
import { first, type Operation, type T, toy } from './machine.test_histories.ts'
import { type Handle, launch } from './transactional.ts'
import { onEach } from './storage.test_databases.ts'
import { clientOf, dialects, quiet, quietly } from './transactional.test_shared.ts'

/** A process on the client: its runtime with the toy deployed, the runs its runner was given, and how it dies. */
const processOn = Effect.gen(function*() {
  const scope = yield* Scope.make()
  const runs: Array<Operation> = []
  // Each run waits for ever, so that it runs until its process dies.
  const runtime = yield* Effect.provideService(launch(), Scope.Scope, scope)
  const handle: Handle<T> = yield* runtime.deploy(
    toy(first, (run) => Effect.andThen(Effect.sync(() => runs.push(run)), Effect.never)),
  ).pipe(Effect.provideService(Scope.Scope, scope))
  return { handle, runs, die: Scope.close(scope, Exit.void) }
})

const run = <A>(body: Effect.Effect<A, never, SqlClient.SqlClient>) =>
  onEach(dialects, (dialect) => Effect.runPromise(body.pipe(Effect.provide(clientOf(dialect)), quietly)))

test('an operation whose process died runs again at the next step of a process that remembers its entity', () =>
  run(Effect.gen(function*() {
    // The first process creates the entity, so it remembers having activated it.
    const remembering = yield* processOn
    yield* remembering.handle.create('e', { requestId: 'creation' })
    yield* quiet
    // A second process starts the droppable run under `d`, and dies with it, so no process holds its fiber.
    const other = yield* processOn
    expect(yield* other.handle.send('e', { _tag: 'Start', key: 'd', nonce: 'n1' }, { requestId: 'r1', keep: 'forever' }))
      .toEqual({ _tag: 'Accepted' })
    yield* quiet
    expect(other.runs.map((started) => started.key)).toContain('d')
    yield* other.die
    // The first process holds no fiber of the run, and runs it again in its next step of the entity.
    yield* remembering.handle.send('e', { _tag: 'Start', key: 'b', nonce: 'n2' }, { requestId: 'r2', keep: 'forever' })
    yield* quiet
    expect(remembering.runs.filter((started) => started.key === 'd')).toEqual([
      { _tag: 'D', key: 'd', gen: 1, shift: 0 },
    ])
    yield* remembering.die
  })))

/** The defect `effect` dies with, as its message. */
const defect = <A, R>(effect: Effect.Effect<A, never, R>) =>
  Effect.map(Effect.exit(effect), (exit) =>
    Exit.isFailure(exit) ? String((Cause.squash(exit.cause) as { reason?: string }).reason) : 'no defect')

test('an id, a request id or a time to keep a reply that is no such value is the caller’s defect', () =>
  run(Effect.gen(function*() {
    const { handle, die } = yield* processOn
    const keep = 'forever' as const
    expect(yield* defect(handle.create('', { requestId: 'c' }))).toBe('the id is empty, and an id is not')
    expect(yield* defect(handle.send('e', { _tag: 'Refuse', nonce: 'n' }, { requestId: 'r\u0000', keep })))
      .toBe('the request id is "r\\u0000", which is no text a database holds')
    expect(yield* defect(handle.send('e', { _tag: 'Refuse', nonce: 'n' }, { requestId: 'r', keep: { millis: -1 } })))
      .toBe('the reply is kept {"millis":-1}, which is no non-negative integer of milliseconds')
    expect(yield* defect(handle.read('\ud800'))).toBe('the id is "\\ud800", which is no text a database holds')
    // A call that steps the entity within the caller's transaction would commit with it, so it is refused.
    const sql = yield* SqlClient.SqlClient
    const within = 'the call runs within a transaction of the client of the runtime'
    expect(yield* defect(Effect.orDie(sql.withTransaction(handle.create('e', { requestId: 'c' }))))).toBe(within)
    expect(yield* defect(Effect.orDie(sql.withTransaction(handle.resume('e'))))).toBe(within)
    const relaunched = Effect.scoped(Effect.flatMap(launch(), (runtime) =>
      Effect.orDie(sql.withTransaction(runtime.deploy(toy(first))))))
    expect(yield* defect(relaunched))
      .toBe('the deploy runs within a transaction of the client of the runtime')
    expect(yield* Effect.orDie(sql.withTransaction(handle.read('e')))).toBeNull()
    yield* die
  })))

test('a retry that is no positive integer of milliseconds is the launcher’s defect', () =>
  run(Effect.gen(function*() {
    const launched = Effect.scoped(launch({ retry: { millis: 0 } }))
    expect(yield* defect(launched)).toBe('the retry is 0 milliseconds, and it is a positive integer')
  })))
