/**
 * How a test of `transactional.ts` waits until the runtime has nothing left to do but wait for an answer or a time.
 * The test runs under `quietly`, so every fiber runs on Effect's scheduler in its `sync` mode, which runs a task in a
 * microtask. SQLite and PGlite answer within microtasks, so the runtime's work ends within them, and a task of the
 * host's timers runs once they are all done. A server of PostgreSQL answers on the network, so on a pool the wait
 * also lasts while a connection is opened or used.
 */
import { PgClient } from '@effect/sql-pg'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import * as Option from 'effect/Option'
import * as Scheduler from 'effect/Scheduler'
import type { SqlClient } from 'effect/sql'
import { client, database, pool, server } from './storage.test_databases.ts'
import type { Dialect } from './storage.ts'

const macrotask = Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

/**
 * Ends once the runtime's work has ended, for a test run by `quietly`. On a pool of `fixed` connections the pool is
 * read after each task of the host's timers. A connection being opened is counted neither idle nor used, so every
 * connection the pool holds is waited for.
 */
export const quiet: Effect.Effect<void> = Effect.gen(function*() {
  yield* macrotask
  const found = yield* Effect.serviceOption(PgClient.PgClient)
  if (Option.isNone(found)) return
  while (true) {
    const { idle, used, pending, min } = yield* found.value.poolStats
    if (used === 0 && pending === 0 && idle >= min) return
    yield* macrotask
  }
})

/** Runs `effect` with every fiber it forks on the scheduler that `quiet` waits for. */
export const quietly = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.provideService(effect, Scheduler.Scheduler, new Scheduler.MixedScheduler('sync'))

/** How many connections the pool of a test on a server holds, from its start to its end. */
export const fixed = 4

/**
 * A client of a new database of `dialect`, as `client` of `storage.test_databases.ts` gives it. On a server it is a
 * pool of `fixed` connections, all opened at its start and kept, which `quiet` reads.
 */
export const clientOf = (dialect: Dialect): Layer.Layer<SqlClient.SqlClient> =>
  dialect === 'pg' && server !== undefined
    ? Layer.unwrap(Effect.map(database(server), (url) => pool(url, { minConnections: fixed, maxConnections: fixed })))
    : client(dialect)

/** The dialects a test of `transactional.ts` runs on. PostgreSQL is PGlite, or the server `POSTGRES_URL` names. */
export const dialects: ReadonlyArray<Dialect> = ['sqlite', 'pg']
