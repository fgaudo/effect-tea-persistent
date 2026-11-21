# The outbox

This page tells other systems what an entity did. Its code is [`examples/order`](../../examples/order), an order
that is paid, charged and shipped, with a dashboard that counts the orders in each status. `bun test` runs it. Read
the guide's [first page](README.md) before it: this page uses its words for a step, a projection and the boundary.
The words in bold are defined in [`glossary.md`](../glossary.md), and
[`design.md`](../design.md#publishing-what-happened) is the specification behind each rule.

## Contents

- [The requirement](#the-requirement)
- [A deploy with the outbox](#a-deploy-with-the-outbox)
- [What a row holds](#what-a-row-holds)
- [One reader, which deletes what it handled](#one-reader-which-deletes-what-it-handled)
- [No order across entities](#no-order-across-entities)
- [The rules, in one list](#the-rules-in-one-list)

## The requirement

A dashboard shows how many orders are in each status. It may miss no order, and a crash of its reader may lose
nothing it was told.

## A deploy with the outbox

The order declares nothing to send. Its deploy asks for the **outbox**:

```ts
const orders = yield* Effect.provide(runtime.deploy(order, { outbox: true }), world)
```

From then on the creation of an order, and each step that changes its projection, writes a row of the table
`effecttea_outbox` in the step's own transaction. So a row is written exactly when its step commits, and no row
tells of a step that did not. A program deployed without the option writes no row.

A step writes a row only where the projection it leaves differs from the one before, compared as canonical JSON. A
step that changes nothing callers read writes none. Nor does a rejected message, a deploy, or `reindex`. **A fact
that must reach another system is shown in the projection.** The booking's inventory shows what happens otherwise:
confirming seats moves them from held to sold and leaves `available` where it was, so no row tells of the sale.

## What a row holds

A row is keyed by the program's `name`, the entity's `id` and its `step`. `step` counts the entity's writes, its
creation the first, so a write that changed no projection leaves a gap. `kind` is `Creation`, `Inbound` or
`Internal`. `message` is the JSON of the message the step handled, and null for a creation. `projection` is the JSON
of the projection the step left, the public contract of the entity. `version` is the version of the program that
wrote both, and `written_at` the step's time in milliseconds. After an order is created and paid, its rows read:

```ts
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
```

Here `outbox` is the test's own query of the table, by `id` and `step`. The step that tells the warehouse changes
only `canCancel`, and writes a row all the same, since the projection changed. A step of a child is the parent's
step, and its row holds the message as the parent received it, wrapped with the child's name.

## One reader, which deletes what it handled

The library never deletes a row of the outbox: neither `expire` nor the sweep does. A reader deletes by key the rows
it handled, with its own SQL. The report of [`report.ts`](../../examples/order/report.ts) keeps the last status of
each order in a table of its own, beside the library's, and fills it from the outbox:

```ts
record: (limit: number) =>
  sql.withTransaction(Effect.gen(function*() {
    const rows = yield* Effect.flatMap(
      sql`SELECT id, step, projection FROM effecttea_outbox WHERE name = ${order.name} ORDER BY id, step LIMIT ${limit}`,
      Schema.decodeUnknownEffect(Rows),
    )
    for (const { id, step, projection } of rows) {
      const { status } = yield* Schema.decodeUnknownEffect(Shown)(JSON.parse(projection))
      yield* sql`
        INSERT INTO order_status (id, status) VALUES (${id}, ${status})
        ON CONFLICT (id) DO UPDATE SET status = excluded.status
      `
      yield* sql`DELETE FROM effecttea_outbox WHERE name = ${order.name} AND id = ${id} AND step = ${step}`
    }
    return rows.length
  })).pipe(Effect.orDie),
```

The store and the deletes commit in one transaction. A crash before the commit leaves both as they were, and the
next reading handles the same rows, so a row is written to the store exactly once. A reader whose store is outside
the database deletes a row only once its store holds it, and is told at least once. A reader reads a program's rows
alone: two readers at once would each handle the same row. A reader that stops leaves the rows where they are, and
the table grows until it reads again.

Within its transaction the reader waits for nothing a step does. The transaction may hold the database's one
connection, as on SQLite, and a step's commit waits for that connection.

## No order across entities

The rows of one entity are in the order of its steps, by `step`. No order holds across entities: a row of one order
written before a row of another may be read after it. The report relies on the first only, since an order's last row
is its last status. A reader that needs an effect after its cause in another entity waits for the cause, or reads the
cause's projection, which a row holds whole.

## The rules, in one list

1. **A program deployed with `outbox: true` writes a row for each creation and each step that changes the
   projection**, in the step's own transaction.
2. **A fact that must reach another system is shown in the projection.**
3. **The rows of one entity are in the order of their `step`**, and no order holds across entities.
4. **The library never deletes a row.** The reader deletes by key the rows it handled, in the transaction that
   writes its store.
