/**
 * The orders on the runtime, and the question the stored states could not answer: which of them nobody paid.
 * The read model is the projection, written in each step's transaction, and `unpaidUntil` is the index a query
 * reads it by (decision 0032).
 */
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { expect, test } from 'bun:test'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import { SqlClient } from 'effect/sql'
import { launch } from '@fgaudo/effect-tea-persistent'
import { Mailer, order, Payments, Warehouse } from './order.ts'
import { statusReport } from './report.ts'

const ada = { _tag: 'Customer', id: 'ada' } as const
/** A limit no reading of this test reaches: a reading says how many rows it takes (decision 0141). */
const all = 100

/** The world the orders act on, which answers and records nothing: this test only reads states. */
const world = Layer.mergeAll(
  Layer.succeed(Payments, Payments.of({ charge: () => Effect.succeed('ch_1'), refund: () => Effect.void })),
  Layer.succeed(Warehouse, Warehouse.of({ prepare: () => Effect.void })),
  Layer.succeed(Mailer, Mailer.of({ send: () => Effect.void })),
)

/** The rows of the outbox the orders wrote, by order and in the order of their steps, as a reader of it reads them. */
const outbox = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  return yield* sql<{ id: string; step: number; kind: string; version: number; message: string | null; projection: string }>`
    SELECT id, step, kind, version, message, projection FROM effecttea_outbox WHERE name = 'Order' ORDER BY id, step
  `
})

const database = <A, E>(test: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(
    Effect.scoped(test).pipe(
      Effect.provide(SqliteClient.layer({ filename: ':memory:' })),
      Effect.orDie,
    ),
  )

test('a query finds the orders nobody paid, and leaves out the one that was', () =>
  database(Effect.scoped(Effect.gen(function*() {
    const runtime = yield* launch()
    const orders = yield* Effect.provide(runtime.deploy(order), world)

    for (const id of ['o-1', 'o-2', 'o-3']) {
      yield* orders.create(id, {
        flags: { order: { customer: 'ada', totalInCents: 1_000 } },
        requestId: `c-${id}`,
        sender: ada,
      })
    }
    yield* orders.send('o-2', { _tag: 'PayRequested', payment: 'card-1' }, { requestId: 'p-2', sender: ada, keep: 'forever' })
    yield* runtime.settled
    expect(yield* orders.read('o-2')).toMatchObject({ status: 'Paid', deadline: null })

    // Every order is created with half an hour to pay: the ones still awaiting it are the ones to chase.
    const now = DateTime.toEpochMillis(yield* DateTime.now)
    const unpaid = yield* orders.query({
      limit: all,
      where: [{ index: 'unpaidUntil', is: '<=', value: now + 3_600_000 }],
      order: { index: 'unpaidUntil' },
    })
    expect(unpaid.map(({ id }) => id)).toEqual(['o-1', 'o-3'])
    expect(unpaid[0]?.projection).toMatchObject({ status: 'AwaitingPayment', canPay: true })
    // A page reads on from the last row of the page before, by the index it orders by and then by the id.
    const firstPage = yield* orders.query({ limit: 1, order: { index: 'unpaidUntil' } })
    const secondPage = yield* orders.query({ limit: 2, order: { index: 'unpaidUntil' }, after: firstPage.at(-1) })
    expect([...firstPage, ...secondPage].map(({ id }) => id)).toEqual(['o-2', 'o-1', 'o-3'])

    // Nobody is late yet, and the order that was paid holds no deadline to be found by.
    expect(yield* orders.query({ limit: all, where: [{ index: 'unpaidUntil', is: '<=', value: now }] })).toEqual([])
    expect((yield* orders.query({ limit: all, where: [{ index: 'unpaidUntil', is: '=', value: null }] })).map(({ id }) => id))
      .toEqual(['o-2'])
    expect((yield* orders.query({ limit: all, where: [{ index: 'unpaidUntil', is: '<>', value: null }] })).map(({ id }) => id))
      .toEqual(['o-1', 'o-3'])
    // An order against no value finds nothing, as in SQL.
    expect(yield* orders.query({ limit: all, where: [{ index: 'unpaidUntil', is: '<', value: null }] })).toEqual([])

    // How many orders await their payment, and what they owe, are read off a page of the query: the paid order is
    // left out by its null.
    const owing = yield* orders.query({ limit: all, where: [{ index: 'owedInCents', is: '<>', value: null }] })
    expect(owing.map(({ id }) => id)).toEqual(['o-1', 'o-3'])
    expect(owing.reduce((total, { projection }) => total + projection.totalInCents, 0)).toBe(2_000)
  }))))

test('what an order wrote to the outbox is what another system learns of it, step by step', () =>
  database(Effect.scoped(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const runtime = yield* launch()
    const orders = yield* Effect.provide(runtime.deploy(order, { outbox: true }), world)

    yield* orders.create('o-1', {
      flags: { order: { customer: 'ada', totalInCents: 1_000 } },
      requestId: 'c-o-1',
      sender: ada,
    })
    yield* orders.send('o-1', { _tag: 'PayRequested', payment: 'card-1' }, { requestId: 'p-1', sender: ada, keep: 'forever' })
    yield* runtime.settled

    // The outbox has a row for the creation and for each step that changed the projection: the request to pay, the
    // charge coming back, and the warehouse told, which changed only `canCancel`. Each row holds the message its step
    // handled, the projection the step left, and the version that wrote it.
    const rows = yield* outbox
    expect(rows.map(({ kind, message, projection }) => [
      kind,
      message === null ? null : (JSON.parse(message) as { _tag: string })._tag,
      (JSON.parse(projection) as { status: string }).status,
    ])).toEqual([
      ['Creation', null, 'AwaitingPayment'],
      ['Inbound', 'PayRequested', 'Charging'],
      ['Internal', 'ChargeSucceeded', 'Paid'],
      ['Internal', 'WarehouseTold', 'Paid'],
    ])
    expect(rows.every(({ version }) => Number(version) === 1)).toBe(true)
    // `step` numbers every write of the entity, so the writes that changed no projection left gaps.
    expect(rows.map(({ step }) => Number(step))).toEqual([1, 2, 4, 6])

    // The library deletes no row of the outbox, not even as it expires the replies. A reader deletes by key the
    // rows it handled.
    yield* orders.expire
    expect(yield* outbox).toHaveLength(rows.length)
    yield* sql`DELETE FROM effecttea_outbox WHERE name = 'Order' AND id = 'o-1' AND step = ${rows[0]?.step ?? 0}`
    expect(yield* outbox).toEqual(rows.slice(1))
  }))))

test('a report built from the outbox counts the orders in each status, as a query of the read model finds them', () =>
  database(Effect.scoped(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const runtime = yield* launch()
    const orders = yield* Effect.provide(runtime.deploy(order, { outbox: true }), world)
    const report = yield* statusReport

    for (const id of ['o-1', 'o-2', 'o-3', 'o-4']) {
      yield* orders.create(id, {
        flags: { order: { customer: 'ada', totalInCents: 1_000 } },
        requestId: `c-${id}`,
        sender: ada,
      })
    }
    for (const id of ['o-2', 'o-3']) {
      yield* orders.send(id, { _tag: 'PayRequested', payment: 'card-1' }, { requestId: `p-${id}`, sender: ada, keep: 'forever' })
    }
    yield* orders.send('o-4', { _tag: 'CancelRequested' }, { requestId: 'x-o-4', sender: ada, keep: 'forever' })
    yield* runtime.settled

    // A reader that crashes after its writes, as a crash before the commit leaves it: the store and the outbox stay
    // as they were, so the next reader handles the same rows.
    const written = yield* outbox
    const crashed = sql.withTransaction(Effect.andThen(report.record(3), Effect.fail('crash')))
    expect(yield* Effect.exit(crashed)).toEqual(Exit.fail('crash'))
    expect(yield* report.counts).toEqual({})
    expect(yield* outbox).toEqual(written)
    while ((yield* report.record(3)) > 0) {}
    expect(yield* outbox).toEqual([])

    // The store answers the question in one statement, and a query of the read model finds as many in each status.
    expect(yield* report.counts).toEqual({ AwaitingPayment: 1, Paid: 2, Cancelled: 1 })
    for (const [status, count] of [['AwaitingPayment', 1], ['Paid', 2], ['Cancelled', 1]] as const) {
      expect(yield* orders.query({ limit: all, where: [{ index: 'status', is: '=', value: status }] })).toHaveLength(count)
    }

    // A later step writes its row, which the next reading handles.
    yield* orders.send('o-1', { _tag: 'CancelRequested' }, { requestId: 'x-o-1', sender: ada, keep: 'forever' })
    yield* runtime.settled
    while ((yield* report.record(3)) > 0) {}
    expect(yield* report.counts).toEqual({ Paid: 2, Cancelled: 2 })
  }))))
