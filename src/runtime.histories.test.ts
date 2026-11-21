/**
 * The histories of `machine.test_histories.ts`, played on the runtime of `transactional.ts` over SQLite and over
 * PostgreSQL. Each history has a database of its own, the test's clock, and a process that a restart kills and
 * launches again on the same database. PostgreSQL is PGlite, or a pool of the server `POSTGRES_URL` names, and plays
 * fewer histories, since each makes a database.
 *
 * The toy's runner waits for the answer the history gives its run. An answer is kept by run, so a run started
 * again after a crash, or answered late, is given it at once.
 */
import { expect, test } from 'bun:test'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Scope from 'effect/Scope'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'
import fc from 'fast-check'
import {
  type Answer,
  first,
  history,
  type Inbound,
  type Operation,
  play,
  type Runner,
  type T,
  type Target,
  toy,
  type Version,
  violations,
} from './machine.test_histories.ts'
import { type Dialect, storage } from './storage.ts'
import { type Handle, launch } from './runtime.ts'
import { clientOf, dialects, quiet, quietly } from './runtime.test_shared.ts'

const id = 'history'

const all = Bun.env['SCHEDULES'] === 'all'

const onRuntime = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const answers = new Map<string, Deferred.Deferred<'End' | 'Again' | 'Die'>>()
  const answerOf = (run: Operation) => {
    const text = JSON.stringify(run)
    const found = answers.get(text)
    if (found !== undefined) return found
    const made = Deferred.makeUnsafe<'End' | 'Again' | 'Die'>()
    answers.set(text, made)
    return made
  }
  // A process restarts only once it is quiet, so every run a committed step stored has called its runner by then.
  // So the runs whose runner was called are the runs started, as the checks count them.
  const started: Array<Operation> = []
  const waiting = new Map<string, Operation>()
  const runner: Runner = (run) =>
    Effect.suspend(() => {
      started.push(run)
      const text = JSON.stringify(run)
      waiting.set(text, run)
      return Deferred.await(answerOf(run)).pipe(
        Effect.ensuring(Effect.sync(() => waiting.delete(text))),
        Effect.flatMap((answer) =>
          answer === 'Die' ? Effect.die('the run died') : Effect.succeed({ _tag: 'Done', run, then: answer } as const)
        ),
      )
    })

  let version = first
  let scope = yield* Scope.make()
  let handle: Handle<T> | undefined
  const launched = () => {
    if (handle === undefined) throw new Error('no process runs')
    return handle
  }
  const start = (deployed: Version) =>
    Effect.gen(function*() {
      version = deployed
      const runtime = yield* launch().pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.provideService(SqlClient.SqlClient, sql),
      )
      handle = yield* Effect.provideService(runtime.deploy(toy(deployed, runner)), Scope.Scope, scope)
      yield* quiet
    })
  /**
   * The process dies with whatever it runs, and a new one deploys `deployed`, or the version deployed. After a new
   * version the creator retries its creation, which changes nothing and is a transaction of the entity. So the
   * entity is activated by the new version, as the machine activates it at the deploy. Without the retry, an entity
   * that holds only a timer would wait for the timer's time, which `docs/open-questions.md` asks about under
   * Programs.
   */
  const restart = (deployed: Version | null) =>
    Effect.gen(function*() {
      yield* Scope.close(scope, Exit.void)
      scope = yield* Scope.make()
      yield* start(deployed ?? version)
      if (deployed === null) return
      yield* launched().create(id, { requestId: 'creation' })
      yield* quiet
    })
  const deployed = (next: Version | null) => next === null ? Effect.void : restart(next)

  yield* start(first)
  yield* launched().create(id, { requestId: 'creation' })
  yield* quiet

  const answered = (run: Operation, answer: 'End' | 'Again' | 'Die') =>
    Effect.andThen(Deferred.succeed(answerOf(run), answer), quiet)

  const target: Target = {
    send: (requestId: string, message: Inbound) =>
      Effect.gen(function*() {
        const answer = yield* launched().send(id, message, { requestId, keep: 'forever' })
        yield* quiet
        if (answer._tag === 'NotFound') {
          return yield* Effect.die(new Error(`${requestId} was answered ${answer._tag}`))
        }
        return answer as Answer
      }),
    running: Effect.sync(() => [...waiting.values()]),
    started: Effect.sync(() => [...started]),
    complete: (run, then) => answered(run, then),
    die: (run) => answered(run, 'Die'),
    advance: (millis) => Effect.andThen(TestClock.adjust(millis), quiet),
    restart,
    resume: (next) =>
      Effect.gen(function*() {
        yield* deployed(next)
        yield* launched().resume(id)
        yield* quiet
      }),
    discard: (next) =>
      Effect.gen(function*() {
        yield* deployed(next)
        yield* launched().discard(id)
        yield* quiet
      }),
    read: Effect.flatMap(Effect.suspend(() => launched().read(id)), (state) =>
      state === null ? Effect.die(new Error(`${id} is not stored`)) : Effect.succeed(state)),
    suspended: Effect.suspend(() =>
      Effect.map(storage(toy(version), sql).suspended, (listed) => listed.some((entity) => entity.id === id))
    ),
  }
  return { target, close: Effect.suspend(() => Scope.close(scope, Exit.void)) }
})

const played = (acts: Parameters<typeof play>[0], dialect: Dialect) =>
  Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      const { target, close } = yield* onRuntime
      const result = yield* play(acts, target)
      yield* close
      return result
    })).pipe(
      Effect.provide([clientOf(dialect), TestClock.layer()]),
      quietly,
    ),
  )

const runs = { sqlite: all ? 10_000 : 1_000, pg: all ? 1_000 : 50 }

for (const dialect of dialects) {
  const over = dialect === 'pg' ? 'PostgreSQL' : 'SQLite'
  test(`a history on the runtime over ${over} keeps the promises of the design`, () =>
    fc.assert(
      fc.asyncProperty(history, async (acts) => {
        expect(violations(await played(acts, dialect))).toEqual([])
      }),
      { numRuns: runs[dialect], includeErrorInReport: true },
    ), all ? 900_000 : 60_000)
}
