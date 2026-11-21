/**
 * A report built from the outbox: how many orders are in each status, which a dashboard shows at every view. The
 * report keeps a store made for the question, a plain table beside the library's, and fills it from the rows the
 * orders wrote to `effecttea_outbox`, read with its own SQL. It deletes the rows it handled in the transaction that
 * writes its store, so that a crash before the commit leaves both as they were, and a row is handled once.
 */
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { SqlClient } from 'effect/sql'
import { order } from './order.ts'

const Rows = Schema.Array(Schema.Struct({ id: Schema.String, step: Schema.Number, projection: Schema.String }))
const Shown = Schema.Struct({ status: Schema.String })
const Counts = Schema.Array(Schema.Struct({ status: Schema.String, count: Schema.Number }))

export const statusReport = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  // The store holds the last status of each order, and not a count per status: a row gives the status its step
  // left and not the one before. The count per status is a grouping over the store.
  yield* sql`CREATE TABLE order_status (id TEXT PRIMARY KEY, status TEXT NOT NULL)`

  return {
    /**
     * Handles at most `limit` rows of the outbox, and gives how many it handled. The rows of one order are read in
     * the order of their steps, so the store keeps the status of its last step. No order holds across orders, and
     * the report needs none.
     */
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

    /** How many orders are in each status, by status, with no entry for a status no order is in. */
    counts: sql`SELECT status, count(*) AS count FROM order_status GROUP BY status`.pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Counts)),
      Effect.map((rows) => Object.fromEntries(rows.map(({ status, count }) => [status, count]))),
      Effect.orDie,
    ),
  }
})
