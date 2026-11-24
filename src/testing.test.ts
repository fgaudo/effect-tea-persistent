/**
 * The check of a program's migrations against the cases a test recorded (decision 0126), and of a projection
 * against `update`, by sender (decision 0213), read as a caller reads it (decision 0276).
 */
import { describe, expect, test } from 'bun:test'
import * as DateTime from 'effect/DateTime'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Schema from 'effect/Schema'
import { TestClock } from 'effect/testing'
import { order, type Sender as OrderSender, type State as OrderState } from './fixtures/order.ts'
import { type Json, type Migration, noWork, operation, type Program } from './program.ts'
import { program as declareProgram, reject as rejectStep } from './program.ts'
import { type MigrationCase, migrationViolations, projectionViolations } from './testing.ts'

describe('migrationViolations (decision 0126)', () => {
  type T = {
    state: Readonly<{ count: number; label: string }>
    flags: null
    inbound: string
    internal: string
    operation: Readonly<{ _tag: 'Ask' }>
    key: 'ask'
    parameter: {}
    rejection: never
    sender: null
    projection: string
    index: never
    services: never
  }

  /** Version 1 stored `{ n }`, version 2 `{ count }`, and version 3, this one, adds a label. */
  const migrations: ReadonlyArray<Migration> = [
    { state: (json) => ({ count: (json as Readonly<{ n: number }>).n }) },
    { state: (json) => ({ ...json as Readonly<Record<string, Json>>, label: 'none' }) },
  ]

  const counter = (migrations: ReadonlyArray<Migration>): Program<T> => ({
    name: 'Counter',
    keys: { ask: null },
    schemas: {
      state: Schema.Struct({ count: Schema.Number, label: Schema.String }),
      flags: Schema.Null,
      inbound: Schema.String,
      internal: Schema.String,
      operation: Schema.TaggedStruct('Ask', {}),
      rejection: Schema.Never,
      sender: Schema.Null,
      projection: Schema.String,
    },
    init: () => ({ count: 0, label: 'none' }),
    update: () => (state) => state,
    work: () => noWork,
    operations: { Ask: operation(() => Effect.succeed('asked')) },
    project: ({ label }) => label,
    indexes: {},
    migrations,
  })

  const cases: ReadonlyArray<MigrationCase> = [
    { from: 1, of: 'state', written: { n: 2 }, read: { count: 2 } },
    { from: 2, of: 'state', written: { count: 2 }, read: { count: 2, label: 'none' } },
  ]

  test('a program whose migrations read what their cases recorded breaks none', () => {
    expect(migrationViolations(counter(migrations), cases)).toEqual([])
  })

  test('a case is compared by its content, whatever the order of its keys', () => {
    const reordered: MigrationCase = { from: 2, of: 'state', written: { count: 2 }, read: { label: 'none', count: 2 } }
    expect(migrationViolations(counter(migrations), [cases[0]!, reordered])).toEqual([])
  })

  test('a migration changed since its case was recorded is named, with what it reads now', () => {
    const changed = [{ state: (json: Json) => ({ count: (json as Readonly<{ n: number }>).n * 10 }) }, migrations[1]!]
    expect(migrationViolations(counter(changed), cases)).toEqual([
      { _tag: 'Changed', example: cases[0]!, got: { count: 20 } },
    ])
  })

  test('a case whose row the program’s version cannot read fails, though the migration still reads it', () => {
    const dropped = [migrations[0]!, {}]
    expect(migrationViolations(counter(dropped), [cases[0]!]).map(({ _tag }) => _tag)).toEqual(['Failed'])
  })

  test('a migration of a kind no case records is unrecorded, and a case from no migration is unknown', () => {
    const unknown: MigrationCase = { from: 3, of: 'state', written: {}, read: {} }
    const none: MigrationCase = { from: 0, of: 'state', written: {}, read: {} }
    expect(migrationViolations(counter(migrations), [cases[1]!, unknown, none])).toEqual([
      { _tag: 'Unknown', example: unknown },
      { _tag: 'Unknown', example: none },
      { _tag: 'Unrecorded', from: 1, of: 'state' },
    ])
  })
})

describe('projectionViolations (decision 0213)', () => {
  const at = DateTime.makeUnsafe('2026-10-30T10:00:00Z')
  const ada: OrderSender = { _tag: 'Customer', id: 'ada' }
  const warehouse: OrderSender = { _tag: 'Warehouse' }
  const told: OrderState = {
    _tag: 'Paid',
    order: { customer: 'ada', totalInCents: 1_000 },
    charge: 'charge-1',
    warehouse: 'Told',
  }

  test('gives allows the sender, so that a projection speaks to each sender of its own', () => {
    const check = projectionViolations(order, {
      CancelRequested: (projection, _, sender) => sender._tag === 'Customer' && projection.canCancel,
      ShipmentReported: (projection, _, sender) => sender._tag === 'Warehouse' && projection.status === 'Paid',
    })
    expect(check(told, [
      { message: { _tag: 'CancelRequested' }, sender: ada },
      { message: { _tag: 'CancelRequested' }, sender: warehouse },
      { message: { _tag: 'ShipmentReported', tracking: 'track-1' }, sender: ada },
      { message: { _tag: 'ShipmentReported', tracking: 'track-1' }, sender: warehouse },
    ], at)).toEqual([])
  })

  test('names the sender of a message allowed and rejected, and of one accepted and not allowed', () => {
    const check = projectionViolations(order, {
      CancelRequested: (projection) => projection.canCancel,
      ShipmentReported: (_projection, _message, sender) => sender._tag === 'Customer',
    })
    expect(check(told, [
      { message: { _tag: 'CancelRequested' }, sender: ada },
      { message: { _tag: 'CancelRequested' }, sender: warehouse },
      { message: { _tag: 'ShipmentReported', tracking: 'track-1' }, sender: ada },
      { message: { _tag: 'ShipmentReported', tracking: 'track-1' }, sender: warehouse },
    ], at)).toEqual([
      { _tag: 'Rejected', message: { _tag: 'CancelRequested' }, sender: warehouse },
      { _tag: 'Rejected', message: { _tag: 'ShipmentReported', tracking: 'track-1' }, sender: ada },
      { _tag: 'Missing', message: { _tag: 'ShipmentReported', tracking: 'track-1' }, sender: warehouse },
    ])
  })

  // Bug 123 of docs/bugs.md: a kind named as a field of `Object.prototype` was read through the prototype chain.
  test.failing('passes over a kind that allows does not hold, though Object.prototype has a field of its name', () => {
    const check = projectionViolations(order, { CancelRequested: (projection) => projection.canCancel })
    expect(check(told, [{ message: { _tag: '__proto__' } as never, sender: ada }], at)).toEqual([])
  })
})

describe('projectionViolations reads the projection as a caller does (decision 0276)', () => {
  const at = DateTime.makeUnsafe('2026-10-30T10:00:00Z')
  const signed = (project: (state: { readonly x: number }) => { readonly x: number }) =>
    declareProgram({
      state: Schema.Struct({ x: Schema.Number }),
      flags: Schema.Null,
      inbound: Schema.TaggedStruct('Act', {}),
      internal: Schema.Never,
      operation: Schema.Never,
      rejection: Schema.Never,
      projection: Schema.Struct({ x: Schema.Number }),
    })({
      name: 'Signed',
      keys: [],
      init: () => ({ x: -0 }),
      update: () => (state) => (Object.is(state.x, -0) ? state : rejectStep),
      work: () => noWork,
      operations: {},
      project,
      indexes: {},
    })

  // A caller reads the projection from its JSON, where `-0` is `0` (decision 0211). Given the value `project`
  // returns, `allows` would allow the message, and the check would pass where a caller is not allowed to act.
  test('gives allows the projection decoded from its JSON, where -0 is 0', () => {
    const check = projectionViolations(signed((state) => state), { Act: (projection) => Object.is(projection.x, -0) })
    // A caller reads `{ x: 0 }`, is not allowed to act, and `update` accepts the message: a `Missing`.
    expect(check({ x: -0 }, [{ message: { _tag: 'Act' }, sender: null }], at)).toEqual([
      { _tag: 'Missing', message: { _tag: 'Act' }, sender: null },
    ])
  })

  // The runtime suspends an entity whose projection does not encode, so no caller reads it, and the check throws.
  test('throws the defect of a projection that does not encode', () => {
    const check = projectionViolations(signed(() => ({ x: Number.NaN })), { Act: () => true })
    expect(() => check({ x: -0 }, [{ message: { _tag: 'Act' }, sender: null }], at)).toThrow(
      'the projection encodes to what JSON does not hold',
    )
  })
})
