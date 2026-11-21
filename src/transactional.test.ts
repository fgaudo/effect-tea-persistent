/**
 * Rules of `transactional.ts` that the histories of one process do not reach: two runtimes on one database, an entity
 * that suspends between the waker's reading and its fire, what a caller or a launcher gives that the runtime
 * refuses, and the readings and the sweep, which step nothing. Each test runs on SQLite and on PostgreSQL.
 */
import { expect, test } from 'bun:test'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'
import { first, type Operation, type T, toy } from './machine.test_histories.ts'
import { type Address, program } from './program.ts'
import { type Handle, launch, type Point } from './transactional.ts'
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

const Counted = Schema.Array(Schema.Struct({ queued: Schema.Number }))

/** How many messages wait in the mailbox of the toy's entity `id`. */
const queuedIn = (sql: SqlClient.SqlClient, id: string) =>
  Effect.orDie(Effect.flatMap(
    sql`SELECT CAST(count(*) AS INTEGER) AS queued FROM effecttea_mailbox WHERE name = 'Histories' AND id = ${id}`,
    Schema.decodeUnknownEffect(Counted),
  )).pipe(Effect.map((rows) => rows[0]?.queued ?? 0))

test('a timer read as due does not fire once its entity suspends before the fire', () =>
  run(Effect.provide(
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const keep = 'forever' as const
      // The fire of `e1` suspends `e2` after its commit, so the waker reads the timer of `e2` as due before the
      // suspension, and fires it after.
      const armed = { now: false }
      let handle: Handle<T> | undefined
      const probe = (point: Point, entity: Address) =>
        Effect.suspend(() => {
          if (!armed.now || point !== 'AfterCommit' || entity.id !== 'e1' || handle === undefined) return Effect.void
          armed.now = false
          const breaking = handle.send('e2', { _tag: 'Break', nonce: 'n3' }, { requestId: 'r3', keep })
          return Effect.map(breaking, (answer) => expect(answer).toEqual({ _tag: 'Suspended' }))
        })
      const scope = yield* Scope.make()
      const runtime = yield* Effect.provideService(launch({ probe }), Scope.Scope, scope)
      handle = yield* Effect.provideService(runtime.deploy(toy(first, () => Effect.never)), Scope.Scope, scope)
      for (const id of ['e1', 'e2']) {
        yield* handle.create(id, { requestId: `c-${id}` })
        yield* handle.send(id, { _tag: 'Start', key: 't', nonce: `t-${id}` }, { requestId: `t-${id}`, keep })
      }
      yield* quiet
      armed.now = true
      yield* TestClock.adjust(10)
      yield* quiet
      expect(armed.now).toBe(false)
      expect((yield* handle.read('e1'))?.seen.map((seen) => seen.tag)).toEqual(['Rang'])
      // The mailbox of `e2` holds the message it died on, and no firing of its timer.
      expect(yield* queuedIn(sql, 'e2')).toBe(1)
      yield* Scope.close(scope, Exit.void)
    }),
    TestClock.layer(),
  )))

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

test('a retry or a sweep that is no positive integer of milliseconds is the launcher’s defect', () =>
  run(Effect.gen(function*() {
    const launched = Effect.scoped(launch({ retry: { millis: 0 } }))
    expect(yield* defect(launched)).toBe('the retry is 0 milliseconds, and it is a positive integer')
    const swept = Effect.scoped(launch({ sweep: { millis: 1.5 } }))
    expect(yield* defect(swept))
      .toBe(`the sweep is {"millis":1.5}, which is neither 'none' nor a positive integer of millis`)
  })))

/** A counter whose projection is its count times `factor`, indexed by what callers read of it. */
const tally = (factor: number) =>
  program({
    state: Schema.Struct({ count: Schema.Int }),
    flags: Schema.Struct({ count: Schema.Int }),
    inbound: Schema.TaggedStruct('Add', { n: Schema.Int }),
    projection: Schema.Struct({ count: Schema.Int }),
  })({
    name: 'Tally',
    init: ({ count }) => ({ count }),
    update: ({ n }) => (state) => ({ count: state.count + n }),
    project: ({ count }) => ({ count: count * factor }),
    indexes: { count: ({ count }) => count },
  })

test('a query reads the read model by its indexes, and a reindex writes it again with the program deployed', () =>
  run(Effect.gen(function*() {
    const deployed = (factor: number) =>
      Effect.gen(function*() {
        const scope = yield* Scope.make()
        const runtime = yield* Effect.provideService(launch(), Scope.Scope, scope)
        const handle = yield* Effect.provideService(runtime.deploy(tally(factor)), Scope.Scope, scope)
        return { handle, die: Scope.close(scope, Exit.void) }
      })
    const once = yield* deployed(1)
    for (const [id, count] of [['a', 1], ['b', 2], ['c', 3]] as const) {
      yield* once.handle.create(id, { requestId: `c-${id}`, flags: { count } })
    }
    const over = (handle: typeof once.handle) =>
      Effect.map(
        handle.query({ where: [{ index: 'count', is: '>', value: 1 }], order: { index: 'count' }, limit: 10 }),
        (found) => found.map(({ id, projection }) => [id, projection.count]),
      )
    expect(yield* over(once.handle)).toEqual([['b', 2], ['c', 3]])
    expect(yield* defect(once.handle.query({ limit: -1 }))).toBe('the limit is -1, which is no non-negative integer')
    yield* once.die
    // A new `project` reaches a row at its entity's next step, or at a reindex.
    const twice = yield* deployed(2)
    expect(yield* over(twice.handle)).toEqual([['b', 2], ['c', 3]])
    expect(yield* twice.handle.reindex).toEqual({ written: 3, failed: [] })
    expect(yield* over(twice.handle)).toEqual([['a', 2], ['b', 4], ['c', 6]])
    yield* twice.die
  })))

test('a suspended entity is listed and inspected from what is stored, and inspecting it steps nothing', () =>
  run(Effect.gen(function*() {
    const { handle, die } = yield* processOn
    yield* handle.create('e', { requestId: 'creation' })
    expect(yield* handle.send('e', { _tag: 'Break', nonce: 'n' }, { requestId: 'r', keep: 'forever' }))
      .toEqual({ _tag: 'Suspended' })
    const listed = yield* handle.suspended
    expect(listed.map(({ id, on, waiting }) => ({ id, on, waiting }))).toEqual([
      { id: 'e', on: { _tag: 'Message', kind: 'Inbound' }, waiting: [] },
    ])
    const found = yield* handle.inspect('e')
    expect(found?.suspension).toEqual(listed[0] ?? null)
    expect(found?.mailbox.map((envelope) => envelope.message._tag)).toEqual(['Break'])
    expect(yield* handle.inspect('e')).toEqual(found)
    expect(yield* handle.inspect('none')).toBeNull()
    expect(yield* defect(handle.inspect(''))).toBe('the id is empty, and an id is not')
    yield* die
  })))

const Replies = Schema.Array(Schema.Struct({ kept: Schema.Number }))

/** How many replies to callers are stored for the toy's entities. */
const repliesKept = (sql: SqlClient.SqlClient) =>
  Effect.orDie(Effect.flatMap(
    sql`SELECT CAST(count(*) AS INTEGER) AS kept FROM effecttea_replies WHERE name = 'Histories'`,
    Schema.decodeUnknownEffect(Replies),
  )).pipe(Effect.map((rows) => rows[0]?.kept ?? 0))

test('a caller’s reply past its time is deleted by expire, and by the sweep at its interval', () =>
  run(Effect.provide(
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      const scope = yield* Scope.make()
      const runtime = yield* Effect.provideService(launch({ sweep: { millis: 100 } }), Scope.Scope, scope)
      const handle = yield* Effect.provideService(runtime.deploy(toy(first, () => Effect.never)), Scope.Scope, scope)
      yield* handle.create('e', { requestId: 'creation' })
      const refused = (requestId: string) =>
        handle.send('e', { _tag: 'Refuse', nonce: requestId }, { requestId, keep: { millis: 10 } })
      yield* refused('r1')
      yield* refused('r2')
      const before = yield* repliesKept(sql)
      yield* TestClock.adjust(20)
      expect(yield* handle.expire).toBe(before)
      expect(yield* repliesKept(sql)).toBe(0)
      yield* refused('r3')
      expect(yield* repliesKept(sql)).toBe(1)
      yield* TestClock.adjust(80)
      yield* quiet
      expect(yield* repliesKept(sql)).toBe(0)
      yield* Scope.close(scope, Exit.void)
    }),
    TestClock.layer(),
  )))
