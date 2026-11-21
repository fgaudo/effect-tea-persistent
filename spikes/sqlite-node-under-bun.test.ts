/**
 * What a rehearsal rests on in `@effect/sql-sqlite-node`, which runs on `node:sqlite`, under Bun. A database in
 * memory runs the statements the storage writes, with SQLite's JSON functions and `RETURNING`. Each client built is
 * a database of its own, so each rehearsal has its own. Two fibers' transactions on one client run one after the
 * other, so a scenario that acts from two fibers steps an entity in one transaction at a time.
 */
import { SqliteClient } from '@effect/sql-sqlite-node'
import { expect, test } from 'bun:test'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Latch from 'effect/Latch'
import { SqlClient } from 'effect/sql'

const inMemory = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) =>
  Effect.runPromise(Effect.provide(effect, SqliteClient.layer({ filename: ':memory:' })))

test('a database in memory runs the JSON functions and RETURNING', async () => {
  const rows = await inMemory(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE rows (id TEXT PRIMARY KEY, body TEXT NOT NULL)`
    return yield* sql<{ id: string; n: number }>`
      INSERT INTO rows (id, body) VALUES ('a', ${JSON.stringify({ n: 3 })})
      RETURNING id, json_extract(body, '$.n') AS n`
  }))
  expect(rows).toEqual([{ id: 'a', n: 3 }])
})

test('each client of a database in memory is a database of its own', async () => {
  const made = Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE rows (id TEXT PRIMARY KEY)`
    yield* sql`INSERT INTO rows (id) VALUES ('a')`
    return (yield* sql<{ n: number }>`SELECT count(*) AS n FROM rows`)[0]?.n
  })
  expect(await inMemory(made)).toBe(1)
  expect(await inMemory(made)).toBe(1)
})

test("a second fiber's transaction on one client waits for the first one's end", async () => {
  const exit = await inMemory(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE rows (id TEXT PRIMARY KEY)`
    const inside = yield* Latch.make()
    const release = yield* Latch.make()
    // The first transaction writes a row, and rolls it back once the second one has begun to wait.
    const first = yield* Effect.forkChild(sql.withTransaction(Effect.gen(function*() {
      yield* sql`INSERT INTO rows (id) VALUES ('first')`
      yield* inside.open
      yield* release.await
      return yield* Effect.fail('rolled back')
    })))
    yield* inside.await
    const second = yield* Effect.forkChild(sql.withTransaction(
      Effect.map(sql<{ n: number }>`SELECT count(*) AS n FROM rows`, (rows) => rows[0]?.n),
    ))
    yield* Effect.yieldNow
    yield* release.open
    yield* Fiber.await(first)
    return yield* Fiber.await(second)
  }))
  expect(exit).toEqual(Exit.succeed(0))
})
