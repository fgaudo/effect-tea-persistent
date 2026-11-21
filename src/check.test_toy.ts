/**
 * A toy program and a process over a database, for the tests of `check.ts`: three operations of each delivery and a
 * timer, whose operations record what they did through `Hands`.
 */
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as Layer from 'effect/Layer'
import * as Schema from 'effect/Schema'
import type { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'
import { defect, type IdempotencyKey, noWork, operation, type Program, rejectWith, timer } from './program.ts'
import { launch, type Options, type Runtime } from './runtime.ts'
import { createTables, type Dialect } from './storage.ts'
import { client, onEach } from './storage.test_databases.ts'

export const keys = ['a', 'b', 'c', 't'] as const
export type Key = (typeof keys)[number]

export const Key = Schema.Literals(keys)

export const State = Schema.Struct({
  want: Schema.Array(Key),
  applied: Schema.Array(Schema.String),
  since: Schema.DateTimeUtcFromMillis,
  rings: Schema.DateTimeUtcFromMillis,
})
export type State = typeof State.Type

export const Inbound = Schema.Union([
  Schema.TaggedStruct('Want', { key: Key, on: Schema.Boolean, nonce: Schema.String }),
  Schema.TaggedStruct('Refuse', { nonce: Schema.String }),
  Schema.TaggedStruct('Break', { nonce: Schema.String }),
])
export type Inbound = typeof Inbound.Type

export const Internal = Schema.Union([
  Schema.TaggedStruct('Done', { key: Key }),
  Schema.TaggedStruct('Unknown', { key: Key }),
  Schema.TaggedStruct('Rang', { key: Key }),
])
export type Internal = typeof Internal.Type

export const Operation = Schema.Union([
  Schema.TaggedStruct('A', {}),
  Schema.TaggedStruct('B', { key: Key }),
  Schema.TaggedStruct('C', { key: Key }),
])
export type Operation = typeof Operation.Type

export const Sender = Schema.TaggedStruct('Tester', {})
export type Sender = typeof Sender.Type

/** What the test's operations do instead of acting on the world: it records them, and may die. */
export class Hands extends Context.Service<Hands, {
  readonly act: (key: Key, idempotencyKey: IdempotencyKey | null) => Effect.Effect<void>
}>()('Hands') {}

export type T = {
  state: State
  flags: Readonly<{ at: DateTime.Utc }>
  inbound: Inbound
  internal: Internal
  operation: Operation
  key: Key
  parameter: {}
  rejection: 'Refused'
  sender: Sender
  projection: number
  index: 'wanted'
  services: Hands
}

export const done = (key: Key): Internal => ({ _tag: 'Done', key })

export const acts = (key: Key, idempotencyKey: IdempotencyKey | null) =>
  Effect.flatMap(Effect.service(Hands), (hands) => Effect.as(hands.act(key, idempotencyKey), done(key)))

export const program: Program<T> = {
  name: 'Toy',
  keys: { a: null, b: null, c: null, t: null },
  schemas: {
    state: State,
    flags: Schema.Struct({ at: Schema.DateTimeUtcFromMillis }),
    inbound: Inbound,
    internal: Internal,
    operation: Operation,
    rejection: Schema.Literal('Refused'),
    sender: Sender,
    projection: Schema.Int,
  },
  init: (_flags, at) => ({ want: keys, applied: [], since: at, rings: DateTime.addDuration(at, '40 millis') }),
  update: (message) => (state) => {
    switch (message._tag) {
      case 'Want': {
        const others = state.want.filter((key) => key !== message.key)
        const want = message.on ? keys.filter((key) => key === message.key || others.includes(key)) : others
        return { ...state, want, applied: [...state.applied, message.nonce] }
      }
      case 'Refuse':
        return rejectWith('Refused')
      case 'Break':
        return defect('broken')
      default:
        return !state.want.includes(message.key)
          ? defect('an internal message for a key the state does not hold')
          : { ...state, want: state.want.filter((key) => key !== message.key) }
    }
  },
  work: (state) =>
    state.want.length === 0 ? noWork : Object.fromEntries(state.want.map((key) => [
      key,
      key === 'a'
        ? { _tag: 'A' } as const
        : key === 'b'
        ? { _tag: 'B', key } as const
        : key === 'c'
        ? { _tag: 'C', key } as const
        : timer<Internal>(state.rings, { _tag: 'Rang', key: 't' }),
    ])),
  operations: {
    A: operation((_operation, idempotencyKey) => acts('a', idempotencyKey)),
    B: operation.atMostOnce(({ key }) => acts(key, null), ({ key }): Internal => ({ _tag: 'Unknown', key })),
    C: operation.atLeastOnce(({ key }) => acts(key, null)),
  },
  project: (state) => state.want.length,
  indexes: { wanted: (projection) => projection },
}

/**
 * The operations' hands, recording every act: a test asserts what ran, and how often. `holds` acts and never
 * comes back, which is an operation whose effect is done in the world and not recorded yet.
 */
export const hands = (options: Readonly<{ holds?: boolean }> = {}) =>
  Effect.sync(() => {
    const acted: Array<string> = []
    return {
      acted,
      layer: Layer.succeed(
        Hands,
        Hands.of({
          act: (key, idempotencyKey) =>
            Effect.gen(function*() {
              acted.push(idempotencyKey === null ? key : `${key}:${idempotencyKey}`)
              if (options.holds === true) return yield* Effect.never
            }),
        }),
      ),
    }
  })


/** A limit no reading of these tests reaches. */
export const all = 1_000

export const tester = { _tag: 'Tester' } as const

/**
 * A database for one test: every process of the test shares it, as a crash leaves the file behind. Time is the
 * test's: it starts at 0, and moves only when the test moves it. `onBoth` runs the test on SQLite and on PGlite.
 */
export const database = <A, E>(test: Effect.Effect<A, E, SqlClient.SqlClient>, dialects: ReadonlyArray<Dialect> = ['sqlite']) =>
  onEach(dialects, (dialect) =>
    Effect.runPromise(
      Effect.scoped(Effect.flatMap(createTables, () => test)).pipe(
        Effect.provide(client(dialect)),
        Effect.provide(TestClock.layer()),
        Effect.orDie,
      ),
    ))

export const onBoth = <A, E>(test: Effect.Effect<A, E, SqlClient.SqlClient>) => database(test, ['sqlite', 'pg'])

/**
 * One process over the database: it ends when the body does, and everything running in it is interrupted. It sweeps
 * nothing unless `sweep` is given.
 */
export const process = <A, E, R>(
  given: Options,
  body: (runtime: Runtime) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | SqlClient.SqlClient> => Effect.scoped(Effect.flatMap(launch({ sweep: 'none', ...given }), body))

/**
 * Runs `effect` in a fiber of its own until it, and everything it sets going, waits: the clock's `adjust` waits for
 * the fibers it wakes to wait again, so what the test starts here is done or held when the fiber is given.
 */
export const running = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function*() {
    const fiber = yield* Effect.forkChild(Effect.delay(effect, '1 millis'))
    yield* TestClock.adjust('1 millis')
    return fiber
  })

/** The same for an effect that ends: what it gives, once everything it set going waits. */
export const ran = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.flatMap(running(effect), Fiber.join)
