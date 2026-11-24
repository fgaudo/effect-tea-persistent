/**
 * Rules of `transactional.ts` that the histories of one process do not reach: two runtimes on one database, an entity
 * that suspends between the waker's reading and its fire, what a caller or a launcher gives that the runtime
 * refuses, and the readings and the sweep, which step nothing. Each test runs on SQLite and on PostgreSQL.
 */
import { expect, test } from 'bun:test'
import * as Cause from 'effect/Cause'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import { SqlClient, SqlError, Statement } from 'effect/sql'
import { TestClock } from 'effect/testing'
import { first, type Operation, type T, toy } from './machine.test_histories.ts'
import { type Address, program } from './program.ts'
import { type Handle, launch, type Point } from './runtime.ts'
import { onEach } from './storage.test_databases.ts'
import { clientOf, dialects, quiet, quietly } from './runtime.test_shared.ts'

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

// Bug 113 of docs/bugs.md. On a server the waker's reading of what is due waits on the network, and the test moves
// the clock while it waits. A waker that slept from the time it read before that reading would sleep past the timer,
// for ever under `TestClock`. Each round races the two, and SQLite and PGlite, which answer within microtasks, pass.
test('fires a timer whose time passes while the waker reads what is due', () =>
  run(Effect.provide(
    Effect.gen(function*() {
      for (let round = 0; round < 20; round++) {
        const { handle, die } = yield* processOn
        const id = `e${round}`
        yield* handle.create(id, { requestId: 'creation' })
        yield* handle.send(id, { _tag: 'Start', key: 't', nonce: 'n' }, { requestId: 'r', keep: 'forever' })
        yield* TestClock.adjust('60 millis')
        yield* quiet
        const state = yield* handle.read(id)
        expect(state?.seen.some(({ tag }) => tag === 'Rang')).toBe(true)
        yield* die
      }
    }),
    TestClock.layer(),
  )))

// Bug 114 of docs/bugs.md: the doc comment of `Due.refused` says the waker tries a refused entity again after
// `retry`, and `waking` reads `ready` and `next` alone. Only SQLite holds a time that is no integer.
test.failing('the waker reads again after the retry an entity whose time it refused', () =>
  onEach(['sqlite'], (dialect) =>
    Effect.runPromise(Effect.provide(
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient
        const { handle, die } = yield* processOn
        yield* handle.create('e', { requestId: 'creation' })
        yield* handle.send('e', { _tag: 'Start', key: 't', nonce: 'n' }, { requestId: 'r', keep: 'forever' })
        yield* quiet
        // An operator writes a time no version writes, and the waker refuses it once the timer's time passes.
        yield* sql`UPDATE effecttea_entity_keys SET due = 'soon' WHERE id = 'e' AND due IS NOT NULL`
        yield* TestClock.adjust('20 millis')
        yield* quiet
        // The operator writes the time back, and the waker's next reading, after its retry, finds the timer due.
        yield* sql`UPDATE effecttea_entity_keys SET due = 0 WHERE id = 'e' AND due IS NOT NULL`
        yield* TestClock.adjust('60 millis')
        yield* quiet
        expect((yield* handle.read('e'))?.seen.some(({ tag }) => tag === 'Rang')).toBe(true)
        yield* die
      }).pipe(Effect.provide(clientOf(dialect)), quietly),
      TestClock.layer(),
    ))))

/** A failure of the database, as a statement or a commit gives it. */
const failure = new SqlError.SqlError({
  reason: new SqlError.UnknownError({ cause: null, message: 'the statement failed' }),
})

// On a pool a step of another entity may commit its timer after the waker's statement of `MIN(due)` and before the
// waker stores the time it sleeps until. The test runs that step in place of the statement, and runs the statement
// blind to that entity, as a snapshot taken before its commit reads. The timer of `x` was stopped, so the waker
// still holds its time, which is before the new timer of `y`.
test('fires a timer that a step arms while the waker reads what is due', () =>
  run(Effect.provide(
    Effect.gen(function*() {
      const keep = 'forever' as const
      const scope = yield* Scope.make()
      let handle: Handle<T> | undefined
      const armed = { now: false }
      const blind: Statement.Transformer = (statement, sql) =>
        Effect.gen(function*() {
          const [text, params] = statement.compile()
          if (!armed.now || !text.includes('MIN(due)') || handle === undefined) return statement
          armed.now = false
          yield* handle.send('y', { _tag: 'Start', key: 't', nonce: 'n' }, { requestId: 'r', keep }).pipe(
            Effect.provideService(Statement.CurrentTransformer, undefined),
          )
          return sql.unsafe(text.replace('WHERE name = ', `WHERE id <> 'y' AND name = `), params)
        })
      const runtime = yield* Effect.provideService(launch(), Scope.Scope, scope)
      handle = yield* runtime.deploy(toy(first, () => Effect.never)).pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.provideService(Statement.CurrentTransformer, blind),
      )
      yield* handle.create('x', { requestId: 'c-x' })
      yield* handle.create('y', { requestId: 'c-y' })
      yield* handle.send('x', { _tag: 'Start', key: 't', nonce: 'start' }, { requestId: 'start', keep })
      yield* quiet
      yield* handle.send('x', { _tag: 'Stop', key: 't', nonce: 'stop' }, { requestId: 'stop', keep })
      armed.now = true
      yield* TestClock.adjust('10 millis')
      yield* quiet
      expect(armed.now).toBe(false)
      yield* TestClock.adjust('60 millis')
      yield* quiet
      expect((yield* handle.read('y'))?.seen.some(({ tag }) => tag === 'Rang')).toBe(true)
      yield* Scope.close(scope, Exit.void)
    }),
    TestClock.layer(),
  )))

// `due` dies on a failure of the database, and the waker reads again after the retry, as it fires again.
test('a reading of what is due that fails in the database is read again at the retry', () =>
  run(Effect.provide(
    Effect.gen(function*() {
      const scope = yield* Scope.make()
      const armed = { now: false }
      const failing: Statement.Transformer = (statement) =>
        Effect.suspend(() => {
          if (!armed.now || !statement.compile()[0].includes('MIN(due)')) return Effect.succeed(statement)
          armed.now = false
          return Effect.die(failure)
        })
      const runtime = yield* Effect.provideService(launch(), Scope.Scope, scope)
      const handle = yield* runtime.deploy(toy(first, () => Effect.never)).pipe(
        Effect.provideService(Scope.Scope, scope),
        Effect.provideService(Statement.CurrentTransformer, failing),
      )
      yield* handle.create('e', { requestId: 'creation' })
      yield* handle.send('e', { _tag: 'Start', key: 't', nonce: 'n' }, { requestId: 'r', keep: 'forever' })
      yield* quiet
      armed.now = true
      yield* TestClock.adjust('10 millis')
      yield* quiet
      expect(armed.now).toBe(false)
      yield* TestClock.adjust('60 millis')
      yield* quiet
      expect((yield* handle.read('e'))?.seen.some(({ tag }) => tag === 'Rang')).toBe(true)
      yield* Scope.close(scope, Exit.void)
    }),
    TestClock.layer(),
  )))

// A run that ends interrupted, though no step dropped it and its process runs, neither completed nor died.
test('an operation that ends interrupted, which no step dropped, suspends its entity', () =>
  run(Effect.gen(function*() {
    const scope = yield* Scope.make()
    const runtime = yield* Effect.provideService(launch(), Scope.Scope, scope)
    const handle = yield* Effect.provideService(
      runtime.deploy(toy(first, (run) => run.key === 'd' ? Effect.interrupt : Effect.never)),
      Scope.Scope,
      scope,
    )
    yield* handle.create('e', { requestId: 'creation' })
    yield* handle.send('e', { _tag: 'Start', key: 'd', nonce: 'n' }, { requestId: 'r', keep: 'forever' })
    yield* quiet
    const suspended = yield* handle.suspended
    expect(suspended.map(({ id, on }) => [id, on._tag])).toEqual([['e', 'Operation']])
    // The run under `b` still runs, so nothing records its `Unknown`.
    expect((yield* handle.inspect('e'))?.mailbox).toEqual([])
    yield* Scope.close(scope, Exit.void)
  })))

// A deploy registers the program and starts its waker, and then restarts the entities a crash interrupted.
test('a deploy whose restart of an interrupted entity fails in the database restarts it at the retry', () =>
  run(Effect.provide(
    Effect.gen(function*() {
      const crashed = yield* processOn
      yield* crashed.handle.create('e', { requestId: 'creation' })
      yield* crashed.handle.send('e', { _tag: 'Start', key: 'd', nonce: 'n' }, { requestId: 'r', keep: 'forever' })
      yield* quiet
      yield* crashed.die
      // The first transaction of the next process is the deploy's restart of `e`, and it fails at its commit.
      const fails = { now: true }
      const probe = (point: Point) =>
        Effect.suspend(() => {
          if (point !== 'BeforeCommit' || !fails.now) return Effect.void
          fails.now = false
          return Effect.die(failure)
        })
      const scope = yield* Scope.make()
      const runs: Array<Operation> = []
      const runtime = yield* Effect.provideService(launch({ probe }), Scope.Scope, scope)
      const deploying = yield* Effect.forkChild(Effect.provideService(
        runtime.deploy(toy(first, (run) => Effect.andThen(Effect.sync(() => runs.push(run)), Effect.never))),
        Scope.Scope,
        scope,
      ))
      yield* quiet
      expect(fails.now).toBe(false)
      yield* TestClock.adjust('50 millis')
      yield* quiet
      const handle = yield* Fiber.join(deploying)
      expect(runs.map(({ key }) => key)).toEqual(['d'])
      expect(yield* handle.read('e')).not.toBeNull()
      yield* Scope.close(scope, Exit.void)
    }),
    TestClock.layer(),
  )))

// Bug 105 of docs/bugs.md: a step PostgreSQL cannot write fails in the database, and is tried again after the retry
// for ever, so the entity's state never moves past it and the entity is not suspended.
test.failing('a completion whose step writes a long index is stepped or suspends its entity, alike on both dialects', () => {
  let seed = 7
  const long = Array.from({ length: 4_000 }, () => {
    seed = (seed * 48_271) % 2_147_483_647
    return String.fromCharCode(97 + (seed % 26))
  }).join('')
  return run(Effect.provide(
    Effect.gen(function*() {
      let runs = 0
      const base = toy(first, (operation) =>
        operation.key === 'd'
          ? Effect.sync(() => (runs++, { _tag: 'Done', run: operation, then: 'End' } as const))
          : Effect.never)
      const indexed = {
        ...base,
        indexes: { done: (state: T['state']) => (state.seen.some(({ tag }) => tag === 'Done') ? long : 'none') },
      } as unknown as typeof base
      const scope = yield* Scope.make()
      const runtime = yield* Effect.provideService(launch(), Scope.Scope, scope)
      const handle = yield* Effect.provideService(runtime.deploy(indexed), Scope.Scope, scope)
      yield* handle.create('e', { requestId: 'creation' })
      yield* handle.send('e', { _tag: 'Start', key: 'd', nonce: 'n' }, { requestId: 'r', keep: 'forever' })
      for (let round = 0; round < 20; round++) {
        yield* TestClock.adjust('60 millis')
        yield* quiet
      }
      // The completion is stepped, or the entity is suspended, and the operation ran once.
      const seen = (yield* handle.read('e'))?.seen ?? []
      const suspended = yield* handle.suspended
      expect({ runs, settled: seen.some(({ tag }) => tag === 'Done') || suspended.length === 1 })
        .toEqual({ runs: 1, settled: true })
      yield* Scope.close(scope, Exit.void)
    }),
    TestClock.layer(),
  ))
})

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
