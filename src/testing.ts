import type * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Equal from 'effect/Equal'
import * as Schema from 'effect/Schema'
import {
  isRejected,
  type Json,
  type Migrated,
  migrationOf,
  type Program,
  readBack,
  type Types,
  versionOf,
} from './program.ts'

type TagOf<Message> = Message extends Readonly<{ _tag: infer Tag extends string }> ? Tag : never

/**
 * For each kind of inbound message the projection speaks of, by its tag, whether the projection allows it to the
 * sender. A projection is plain data (a `canCancel`), so the test says which of its fields stands for which message,
 * and for which sender: a customer's `canCancel` does not allow support to cancel. Kinds it does not speak of (a
 * report from the warehouse) are left out.
 */
export type Allows<T extends Types> = {
  readonly [Tag in TagOf<T['inbound']>]?: (
    projection: T['projection'],
    message: Extract<T['inbound'], Readonly<{ _tag: Tag }>>,
    sender: T['sender'],
  ) => boolean
}

/** An inbound message a caller could send, with who sends it. */
export type Candidate<T extends Types> = Readonly<{ message: T['inbound']; sender: T['sender'] }>

/**
 * How a projection breaks its agreement with `update` in a state:
 * - `Rejected`: it allows a message that `update` rejects, so a caller who acts on what it reads is refused;
 * - `Missing`: `update` accepts a message that it does not allow, so no caller learns that it may.
 */
export type ProjectionViolation<T extends Types> = Readonly<{ _tag: 'Rejected' | 'Missing' } & Candidate<T>>

/**
 * Checks `program.project(state)` against `update` in `state`, both ways, as effect-tea's `dispatchViolations`
 * checks a view. The `candidates` are the messages a test asks about, each with its sender: the messages of an
 * order, sent by its customer and by the warehouse. Each is sent as a caller at `at`. A candidate
 * the projection allows to its sender must be accepted, and one it does not allow must be rejected. Candidates of a
 * kind `allows` leaves out are skipped. A retry is answered from the stored reply, so nothing here checks that a message acts once.
 * `allows` is given the projection as a caller reads it, decoded from its JSON, where `-0` is `0`. A projection that
 * does not encode throws the defect the runtime suspends the entity on, since no caller reads it. `update` is given
 * `state` and each candidate as the test gives them (decision 0276).
 * Returns every violation, so that a test can assert there are none, for generated states.
 */
export const projectionViolations = <T extends Types>(program: Program<T>, allows: NoInfer<Allows<T>>) =>
(
  state: T['state'],
  candidates: Iterable<Candidate<T>>,
  at: DateTime.Utc,
): ReadonlyArray<ProjectionViolation<T>> => {
  const projection = readBack(program.schemas.projection, program.project(state), 'projection')
  const violations: Array<ProjectionViolation<T>> = []
  for (const { message, sender } of candidates) {
    // `Allows` has a predicate for some tags of `T['inbound']`, which TypeScript cannot index by a tag it holds.
    type Allowed = (projection: T['projection'], message: T['inbound'], sender: T['sender']) => boolean
    const held = allows as Readonly<Record<string, Allowed>>
    const tag = (message as Readonly<{ _tag: string }>)._tag
    // A tag such as `__proto__` would be found on `Object.prototype`, which holds no predicate of `allows`.
    if (!Object.hasOwn(held, tag)) continue
    const allowed = held[tag] as Allowed
    const shown = allowed(projection, message, sender)
    const accepted = !isRejected(program.update(message, { at, from: { _tag: 'Caller', sender } })(state))
    if (shown && !accepted) violations.push({ _tag: 'Rejected', message, sender })
    if (!shown && accepted) violations.push({ _tag: 'Missing', message, sender })
  }
  return violations
}

/**
 * A case of a migration, recorded when the migration was written: version `from` wrote `written` of the kind `of`,
 * and version `from + 1` reads `read`. A migration that is deployed is never changed, so a case holds for as long
 * as the program carries the migration (decision 0126).
 */
export type MigrationCase = Readonly<{ from: number; of: Migrated; written: Json; read: Json }>

/**
 * How a program breaks the cases a test recorded of its migrations:
 * - `Changed`: the migration from `from` now reads `written` as `got`, not as the recorded `read`;
 * - `Failed`: the migration from `from`, the migrations after it, or the program's schema of the kind, die on
 *   `written`, so a row it wrote cannot be read at the program's version;
 * - `Unrecorded`: the migration from `from` changes the kind `of`, and no case records what it does;
 * - `Unknown`: a case from a version the program has no migration from.
 */
export type MigrationViolation =
  | Readonly<{ _tag: 'Changed'; example: MigrationCase; got: Json }>
  | Readonly<{ _tag: 'Failed'; example: MigrationCase; reason: string }>
  | Readonly<{ _tag: 'Unrecorded'; from: number; of: Migrated }>
  | Readonly<{ _tag: 'Unknown'; example: MigrationCase }>

/**
 * Checks a program's migrations against the cases a test recorded of them. Each case must still be read as it
 * recorded, and what it wrote must still be read at the program's version: migrated through every migration after
 * it, and decoded by the program's schema. Each function a migration declares must have a case, so that a
 * migration nobody recorded is not changed in silence. Returns every violation, so that a test can assert there
 * are none (decision 0126).
 */
export const migrationViolations = <T extends Types>(
  program: Program<T>,
  cases: Iterable<MigrationCase>,
): ReadonlyArray<MigrationViolation> => {
  const migrations = program.migrations ?? []
  const violations: Array<MigrationViolation> = []
  const recorded = new Set<string>()
  for (const example of cases) {
    const { from, of, written, read } = example
    if (!Number.isInteger(from) || from < 1 || from >= versionOf(program)) {
      violations.push({ _tag: 'Unknown', example })
      continue
    }
    recorded.add(`${of}@${from}`)
    const up = migrations[from - 1]?.[of] ?? ((json: Json) => json)
    try {
      const got = up(written)
      if (!Equal.equals(got, read)) violations.push({ _tag: 'Changed', example, got })
      Schema.decodeSync(program.schemas[of] as Schema.Codec<unknown, Json>)(migrationOf(program, of, from)(written))
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message.split('\n')[0] ?? '' : String(cause)
      violations.push({ _tag: 'Failed', example, reason })
    }
  }
  migrations.forEach((migration, at) => {
    for (const of of Object.keys(migration) as ReadonlyArray<Migrated>) {
      if (migration[of] !== undefined && !recorded.has(`${of}@${at + 1}`)) {
        violations.push({ _tag: 'Unrecorded', from: at + 1, of })
      }
    }
  })
  return violations
}

/**
 * A value frozen through: its plain objects and arrays. Anything else — a `DateTime`, a schema — is left as it is,
 * since Effect may keep on it what it computes of it. The library's tests run on such values, so that a mutation of
 * the library's throws (decision 0052); not part of the public surface.
 */
export const frozen = <A>(value: A): A => {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  const prototype: unknown = Object.getPrototypeOf(value)
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return value
  Object.freeze(value)
  for (const field of Object.values(value)) frozen(field)
  return value
}

const freezings = new WeakMap<object, object>()

/**
 * `program`, whose every value crosses the library frozen: what `init`, `update`, `work` and `project` give,
 * and what its runners deliver. The same program gives the same one, which a runtime may compare by identity.
 */
export const freezing = <T extends Types>(program: Program<T>): Program<T> => {
  const held = freezings.get(program)
  if (held !== undefined) return held as Program<T>
  type Any = Readonly<{
    delivery: string
    run: (...args: ReadonlyArray<unknown>) => Effect.Effect<unknown, never, unknown>
    unknown?: (operation: unknown) => unknown
  }>
  const operations = Object.fromEntries(
    Object.entries(program.operations as Readonly<Record<string, Any>>).map(([tag, runner]) => [tag, {
      ...runner,
      run: (...args: ReadonlyArray<unknown>) => Effect.map(runner.run(...args), frozen),
      ...(runner.unknown === undefined ? {} : { unknown: (operation: unknown) => frozen(runner.unknown?.(operation)) }),
    }]),
  ) as unknown as Program<T>['operations']
  const wrapped: Program<T> = {
    ...program,
    init: (flags, at) => frozen(program.init(flags, at)),
    update: (message, meta) => (state) => frozen(program.update(message, meta)(state)),
    work: (state) => frozen(program.work(state)),
    project: (state) => frozen(program.project(state)),
    operations,
  }
  freezings.set(program, wrapped)
  return wrapped
}

