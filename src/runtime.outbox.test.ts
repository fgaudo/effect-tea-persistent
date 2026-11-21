/**
 * The outbox of a program deployed with `outbox: true`: which steps write a row, what a row holds, and that the
 * library deletes none. Each test runs on SQLite and on PostgreSQL.
 */
import { expect, test } from 'bun:test'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'
import { type Migration, noWork, program, reject } from './program.ts'
import { launch } from './runtime.ts'
import { clientOf, dialects, quietly } from './runtime.test_shared.ts'
import { onEach } from './storage.test_databases.ts'

const Inbound = Schema.TaggedUnion({ Set: { value: Schema.String }, Touch: {}, Refuse: {} })

/**
 * A note whose projection is its last value, as `project` shows it. `Touch` changes the state and leaves the
 * projection, and `Refuse` is rejected.
 */
const note = (project: (last: string) => string, migrations: ReadonlyArray<Migration> = []) =>
  program({
    state: Schema.Struct({ last: Schema.String, touched: Schema.Int }),
    flags: Schema.Null,
    inbound: Inbound,
    projection: Schema.String,
  })({
    name: 'Note',
    keys: [],
    init: () => ({ last: 'a', touched: 0 }),
    update: (message) => (state) => {
      if (message._tag === 'Refuse') return reject
      if (message._tag === 'Touch') return { ...state, touched: state.touched + 1 }
      return { ...state, last: message.value }
    },
    work: () => noWork,
    operations: {},
    project: ({ last }) => project(last),
    migrations,
  })

const first = note((last) => last)

const keep = 'forever' as const

const Rows = Schema.Array(Schema.Struct({
  id: Schema.String,
  step: Schema.Number,
  kind: Schema.String,
  version: Schema.Number,
  written_at: Schema.Number,
  message: Schema.NullOr(Schema.String),
  projection: Schema.String,
}))

/** The rows of the outbox, by entity and step, each its id, step, kind, message, projection and version. */
const outbox = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const rows = yield* Effect.flatMap(
    sql`SELECT id, step, kind, version, written_at, message, projection FROM effecttea_outbox ORDER BY name, id, step`,
    Schema.decodeUnknownEffect(Rows),
  )
  return rows.map(({ id, step, kind, version, message, projection }) => [
    id,
    step,
    kind,
    message === null ? null : JSON.parse(message),
    JSON.parse(projection),
    version,
  ])
}).pipe(Effect.orDie)

const run = <A, E>(body: Effect.Effect<A, E, SqlClient.SqlClient | Scope.Scope>) =>
  onEach(dialects, (dialect) =>
    Effect.runPromise(Effect.scoped(Effect.orDie(body)).pipe(Effect.provide(clientOf(dialect)), quietly)))

test('a creation and each step that changes the projection write one row, in the order of the steps', () =>
  run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const runtime = yield* launch()
    const notes = yield* runtime.deploy(first, { outbox: true })
    const before = Date.now()
    yield* notes.create('n', { requestId: 'c' })
    yield* notes.send('n', { _tag: 'Set', value: 'b' }, { requestId: 'r1', keep })
    // A step that changes the state and leaves the projection writes no row, nor does a rejected message, nor a
    // step that sets the value the projection already shows.
    yield* notes.send('n', { _tag: 'Touch' }, { requestId: 'r2', keep })
    expect(yield* notes.send('n', { _tag: 'Refuse' }, { requestId: 'r3', keep })).toEqual({ _tag: 'Rejected', reason: null })
    yield* notes.send('n', { _tag: 'Set', value: 'b' }, { requestId: 'r4', keep })
    yield* notes.send('n', { _tag: 'Set', value: 'c' }, { requestId: 'r5', keep })
    yield* runtime.settled
    // `step` is the entity's count of writes after the step, so the writes that left the projection leave gaps.
    expect(yield* outbox).toEqual([
      ['n', 1, 'Creation', null, 'a', 1],
      ['n', 2, 'Inbound', { _tag: 'Set', value: 'b' }, 'b', 1],
      ['n', 6, 'Inbound', { _tag: 'Set', value: 'c' }, 'c', 1],
    ])
    const times = yield* sql<{ written_at: number }>`SELECT written_at FROM effecttea_outbox ORDER BY step`
    const written = times.map(({ written_at }) => Number(written_at))
    expect(written.every((at, index) => at >= before && at >= (written[index - 1] ?? before))).toBe(true)
  })))

test('a deploy and a reindex write no row, and a step of a later version writes its version', () =>
  run(Effect.gen(function*() {
    const scope = yield* Scope.make()
    const runtime = yield* Effect.provideService(launch(), Scope.Scope, scope)
    const notes = yield* Effect.provideService(runtime.deploy(first, { outbox: true }), Scope.Scope, scope)
    yield* notes.create('n', { requestId: 'c' })
    yield* runtime.settled
    yield* Scope.close(scope, Exit.void)
    const written = yield* outbox
    expect(written).toHaveLength(1)
    // Version 2 shows the value in capitals: the deploy and the reindex change the projection a query reads, and no
    // step handled a message, so neither writes a row.
    const later = yield* launch()
    const second = yield* later.deploy(note((last) => last.toUpperCase(), [{}]), { outbox: true })
    expect((yield* second.reindex).written).toBe(1)
    expect(yield* second.read('n')).toBe('A')
    expect(yield* outbox).toEqual(written)
    // A step compares the projections the program deployed computes before and after it.
    yield* second.send('n', { _tag: 'Touch' }, { requestId: 'r1', keep })
    yield* second.send('n', { _tag: 'Set', value: 'b' }, { requestId: 'r2', keep })
    yield* later.settled
    expect((yield* outbox).slice(1)).toEqual([['n', 3, 'Inbound', { _tag: 'Set', value: 'b' }, 'B', 2]])
  })))

test('a program deployed without the outbox writes no row, beside one deployed with it', () =>
  run(Effect.gen(function*() {
    const runtime = yield* launch()
    const unkept = yield* runtime.deploy(first)
    const kept = yield* runtime.deploy({ ...note((last) => last), name: 'Kept' }, { outbox: true })
    for (const handle of [unkept, kept]) {
      yield* handle.create('n', { requestId: 'c' })
      yield* handle.send('n', { _tag: 'Set', value: 'b' }, { requestId: 'r', keep })
    }
    yield* runtime.settled
    const sql = yield* SqlClient.SqlClient
    const names = yield* sql<{ name: string }>`SELECT DISTINCT name FROM effecttea_outbox`
    expect(names.map(({ name }) => name)).toEqual(['Kept'])
  })))

test('expire deletes the replies past their time, and no row of the outbox', () =>
  run(Effect.provide(
    Effect.gen(function*() {
      const runtime = yield* launch({ sweep: 'none' })
      const notes = yield* runtime.deploy(first, { outbox: true })
      yield* notes.create('n', { requestId: 'c' })
      yield* notes.send('n', { _tag: 'Set', value: 'b' }, { requestId: 'r', keep: { millis: 10 } })
      yield* runtime.settled
      const written = yield* outbox
      expect(written).toHaveLength(2)
      yield* TestClock.adjust(20)
      expect(yield* notes.expire).toBe(1)
      expect(yield* outbox).toEqual(written)
    }),
    TestClock.layer(),
  )))
