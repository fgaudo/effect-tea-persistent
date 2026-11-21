/**
 * Transactions of the runtime of `transactional.ts` that overlap on a pool of PostgreSQL. Only a server holds them:
 * SQLite and PGlite run one transaction at a time. So each test runs where `POSTGRES_URL` names a server, and is
 * skipped elsewhere. A test holds one transaction at its commit by the probe, and reads `pg_locks` to know that
 * another waits for a lock.
 */
import { expect, test } from 'bun:test'
import * as Context from 'effect/Context'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Schema from 'effect/Schema'
import * as Scope from 'effect/Scope'
import { SqlClient } from 'effect/sql'
import { TestClock } from 'effect/testing'
import { booking } from './fixtures/booking.ts'
import { inventory } from './fixtures/inventory.ts'
import { first, type T, toy } from './machine.test_histories.ts'
import { type Address, operation, type Program, send, type Types } from './program.ts'
import { server } from './storage.test_databases.ts'
import { type Handle, launch, type Options, type Point } from './runtime.ts'
import { clientOf, quiet, quietly } from './runtime.test_shared.ts'

const onServer = test.skipIf(server === undefined)

const run = <A>(body: Effect.Effect<A, never, SqlClient.SqlClient>) =>
  Effect.runPromise(body.pipe(Effect.provide([clientOf('pg'), TestClock.layer()]), quietly))

/** `effect` on a connection of the pool's own, outside the transaction of the fiber that runs it. */
const outside = <A>(sql: SqlClient.SqlClient, effect: Effect.Effect<A>) =>
  Effect.updateContext(effect, (services: Context.Context<never>) => Context.omit(sql.transactionService)(services))

const Waiting = Schema.Array(Schema.Struct({ waiting: Schema.Number }))

/** Ends once a transaction of the database waits for a lock another holds. */
const someoneWaits = (sql: SqlClient.SqlClient): Effect.Effect<void> =>
  outside(
    sql,
    Effect.gen(function*() {
      while (true) {
        const rows = yield* Effect.orDie(Effect.flatMap(
          sql`SELECT count(*)::int AS waiting FROM pg_locks WHERE NOT granted`,
          Schema.decodeUnknownEffect(Waiting),
        ))
        if ((rows[0]?.waiting ?? 0) > 0) return
        yield* Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 5)))
      }
    }),
  )

/**
 * A probe that holds the first transaction of the entity `id` to reach `point` once armed, until `release` is done.
 * `held` is done once it holds it.
 */
const gate = (id: string, point: Point = 'BeforeCommit') => {
  const held = Deferred.makeUnsafe<void>()
  const release = Deferred.makeUnsafe<void>()
  const state = { armed: false }
  const probe: NonNullable<Options['probe']> = (at, entity) =>
    Effect.suspend(() => {
      if (!state.armed || at !== point || entity.id !== id) return Effect.void
      state.armed = false
      return Effect.andThen(Deferred.succeed(held, undefined), Deferred.await(release))
    })
  return { held, release, state, probe }
}

/** A process with the toy deployed, whose runs wait for ever. */
const toyOn = (options: Options) =>
  Effect.gen(function*() {
    const scope = yield* Scope.make()
    const runtime = yield* Effect.provideService(launch(options), Scope.Scope, scope)
    const deployed = runtime.deploy(toy(first, () => Effect.never))
    const handle: Handle<T> = yield* Effect.provideService(deployed, Scope.Scope, scope)
    return { handle, die: Scope.close(scope, Exit.void) }
  })

const keep = 'forever' as const

onServer('a step of an entity waits for another step of the entity, and reads what that step wrote', () =>
  run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const { held, release, state, probe } = gate('e')
    const { handle, die } = yield* toyOn({ probe })
    yield* handle.create('e', { requestId: 'creation' })
    yield* quiet
    state.armed = true
    const stop = (nonce: string) => handle.send('e', { _tag: 'Stop', key: 'd', nonce }, { requestId: nonce, keep })
    const one = yield* Effect.forkChild(stop('n1'))
    yield* Deferred.await(held)
    const two = yield* Effect.forkChild(stop('n2'))
    yield* someoneWaits(sql)
    expect(two.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(release, undefined)
    expect(yield* Fiber.join(one)).toEqual({ _tag: 'Accepted' })
    expect(yield* Fiber.join(two)).toEqual({ _tag: 'Accepted' })
    expect((yield* handle.read('e'))?.applied).toEqual(['n1', 'n2'])
    yield* die
  })))

onServer('a creation waits for another creation of the entity, and finds the entity it made', () =>
  run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const { held, release, state, probe } = gate('e')
    const { handle, die } = yield* toyOn({ probe })
    state.armed = true
    const one = yield* Effect.forkChild(handle.create('e', { requestId: 'c1' }))
    yield* Deferred.await(held)
    const two = yield* Effect.forkChild(handle.create('e', { requestId: 'c2' }))
    yield* someoneWaits(sql)
    expect(two.pollUnsafe()).toBeUndefined()
    yield* Deferred.succeed(release, undefined)
    expect(yield* Fiber.join(one)).toEqual({ _tag: 'Created' })
    expect(yield* Fiber.join(two)).toEqual({ _tag: 'AlreadyExists' })
    yield* die
  })))

/** The statement that locks the row of `entity`, within the transaction of the fiber that runs it. */
const lockRow = (sql: SqlClient.SqlClient, entity: Address) =>
  Effect.orDie(Effect.asVoid(
    sql`SELECT 1 FROM effecttea_entities WHERE name = ${entity.name} AND id = ${entity.id} FOR UPDATE`,
  ))

const organizer = { _tag: 'Organizer' } as const

onServer('a hold whose transaction of the inventory a deadlock ends sends again at the retry, and is answered', () =>
  run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const retry = { millis: 100 }
    const gig: Address = { name: 'Inventory', id: 'gig' }
    const other: Address = { name: 'Inventory', id: 'other' }
    const armed = { now: false }
    const otherHeld = Deferred.makeUnsafe<void>()
    // The caller's step of `other` holds its row, and waits for the hold's step of `gig`, which waits for the row of
    // `other`. The step of `gig` waits first, so PostgreSQL's check of deadlocks ends it, and the other commits.
    const probe: NonNullable<Options['probe']> = (point, entity) =>
      Effect.suspend(() => {
        if (!armed.now || point !== 'BeforeCommit') return Effect.void
        if (entity.id === other.id) {
          return Effect.gen(function*() {
            yield* Deferred.succeed(otherHeld, undefined)
            yield* someoneWaits(sql)
            yield* lockRow(sql, gig)
          })
        }
        if (entity.id !== gig.id) return Effect.void
        armed.now = false
        return Effect.andThen(Deferred.await(otherHeld), lockRow(sql, other))
      })
    const scope = yield* Scope.make()
    const runtime = yield* Effect.provideService(launch({ retry, probe }), Scope.Scope, scope)
    const deploy = <P extends Types>(program: Program<P>) =>
      Effect.provideService(runtime.deploy(program), Scope.Scope, scope)
    const inventories = yield* deploy(inventory)
    const bookings = yield* deploy(booking)
    yield* inventories.create('gig', { flags: { capacity: 10 }, requestId: 'c-gig', sender: organizer })
    yield* inventories.create('other', { flags: { capacity: 10 }, requestId: 'c-other', sender: organizer })
    yield* quiet
    armed.now = true
    const closing = yield* Effect.forkChild(
      inventories.send('other', { _tag: 'CloseRequested' }, { requestId: 'close', keep, sender: organizer }),
    )
    yield* Deferred.await(otherHeld)
    yield* bookings.create('b1', {
      flags: { customer: 'ann', event: 'gig', seats: 3 },
      requestId: 'c-b1',
      sender: { _tag: 'Customer', id: 'ann' },
    })
    expect(yield* Fiber.join(closing)).toEqual({ _tag: 'Accepted' })
    yield* quiet
    expect((yield* bookings.read('b1'))?.status).toBe('Holding')
    expect((yield* inventories.read('gig'))?.available).toBe(10)
    yield* TestClock.adjust(retry.millis)
    yield* quiet
    expect((yield* bookings.read('b1'))?.status).toBe('Held')
    expect((yield* inventories.read('gig'))?.available).toBe(7)
    yield* Scope.close(scope, Exit.void)
  })), 30_000)

type Hold = Readonly<{ event: string; seats: number }>

type Unavailable = 'SoldOut' | 'SalesClosed' | 'NoSuchEvent'

/**
 * The booking with a hold that acts at most once, and sends once `go` is done. A process that finds the hold with no
 * fiber records it `unknown`, which ends its work, as a second runtime on the database finds the first's hold.
 */
const unsure = (go: Deferred.Deferred<void>): typeof booking => ({
  ...booking,
  operations: {
    ...booking.operations,
    Hold: operation.atMostOnce(
      (op: Hold) =>
        Effect.gen(function*() {
          yield* Deferred.await(go)
          const reply = yield* send(inventory, op.event, { _tag: 'HoldRequested', seats: op.seats }, 'hold')
          return reply._tag === 'Accepted'
            ? { _tag: 'SeatsHeld' } as const
            : { _tag: 'SeatsUnavailable', reason: 'NoSuchEvent' as Unavailable } as const
        }),
      () => ({ _tag: 'SeatsUnavailable', reason: 'SalesClosed' as Unavailable }) as const,
    ),
  },
})

const Left = Schema.Array(Schema.Struct({ remaining: Schema.Number }))

/** How many rows of `table` the booking `b1` asked for, which the sweep deletes once its work has ended. */
const leftBy = (sql: SqlClient.SqlClient, table: 'effecttea_replies' | 'effecttea_answers') =>
  Effect.orDie(Effect.flatMap(
    sql`SELECT count(*)::int AS remaining FROM ${sql(table)} WHERE sender_name = 'Booking' AND sender_id = 'b1'`,
    Schema.decodeUnknownEffect(Left),
  )).pipe(Effect.map((rows) => rows[0]?.remaining ?? 0))

/**
 * The hold of the first process sends to the inventory `event`, while the second process ends the hold's work. The
 * receiver stores the reply, or for an inventory not stored the answer `NotFound`, and reads whether the asker's work
 * holds. The asker's step deletes the rows of the work it ends. Where `first` is the receiver, its step is held at
 * its commit while the asker's step runs, and the asker's step is held otherwise. Neither step waits for the other,
 * and each misses the other's write, so the row is left for the sweep, which deletes it.
 */
const overlapping = (event: 'gig' | 'none', first: 'receiver' | 'asker') =>
  run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const go = Deferred.makeUnsafe<void>()
    const program = unsure(go)
    const receiving = gate(event)
    const asking = gate('b1')
    const processOf = (options: Options) =>
      Effect.gen(function*() {
        const scope = yield* Scope.make()
        const runtime = yield* Effect.provideService(launch(options), Scope.Scope, scope)
        const deploy = <P extends Types>(deployed: Program<P>) =>
          Effect.provideService(runtime.deploy(deployed), Scope.Scope, scope)
        return { deploy, die: Scope.close(scope, Exit.void) }
      })
    const one = yield* processOf({ probe: receiving.probe })
    const inventories = yield* one.deploy(inventory)
    const bookings = yield* one.deploy(program)
    yield* inventories.create('gig', { flags: { capacity: 10 }, requestId: 'c-gig', sender: organizer })
    yield* bookings.create('b1', {
      flags: { customer: 'ann', event, seats: 3 },
      requestId: 'c-b1',
      sender: { _tag: 'Customer', id: 'ann' },
    })
    yield* quiet
    // The second process restarts the hold of `b1` as it deploys the booking, which records it `unknown`.
    const two = yield* processOf({ probe: asking.probe })
    yield* two.deploy(inventory)
    if (first === 'receiver') {
      receiving.state.armed = true
      yield* Deferred.succeed(go, undefined)
      yield* Deferred.await(receiving.held)
      yield* two.deploy(program)
      yield* Deferred.succeed(receiving.release, undefined)
    } else {
      asking.state.armed = true
      const deployed = yield* Effect.forkChild(two.deploy(program))
      yield* Deferred.await(asking.held)
      yield* Deferred.succeed(go, undefined)
      // The first process's step of `b1` that records the reply waits for the second's, once the receiver committed.
      yield* someoneWaits(sql)
      yield* Deferred.succeed(asking.release, undefined)
      yield* Fiber.join(deployed)
    }
    yield* quiet
    const table = event === 'gig' ? 'effecttea_replies' : 'effecttea_answers'
    const status = (yield* bookings.read('b1'))?.status
    const left = yield* leftBy(sql, table)
    yield* bookings.expire
    const found = { status, left, after: yield* leftBy(sql, table) }
    yield* two.die
    yield* one.die
    return found
  }))

for (const event of ['gig', 'none'] as const) {
  const row = event === 'gig' ? 'reply' : 'answer NotFound'
  for (const first of ['receiver', 'asker'] as const) {
    const name = `the ${row} a receiver stores as the work that asked ends is left for the sweep, the ${first} held`
    onServer(name, async () => {
      expect(await overlapping(event, first)).toEqual({ status: 'Cancelled', left: 1, after: 0 })
    }, 30_000)
  }
}
