/**
 * Entities that talk on the runtime of `transactional.ts`, which the histories of one entity do not reach: the
 * booking and the inventory of `src/fixtures/`. An operation's request is sent in a transaction of the receiver,
 * on the sender's fiber, and a request with no reply yet is sent again after the retry. Each test runs on SQLite and
 * on PostgreSQL.
 */
import { expect, test } from 'bun:test'
import * as Clock from 'effect/Clock'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Scope from 'effect/Scope'
import { SqlClient, SqlError } from 'effect/sql'
import { TestClock } from 'effect/testing'
import { booking } from './fixtures/booking.ts'
import { inventory } from './fixtures/inventory.ts'
import { create, defect, operation, type Program, rejectWith, send, type Types } from './program.ts'
import { storage } from './storage.ts'
import { launch, type Options } from './transactional.ts'
import { onEach } from './storage.test_databases.ts'
import { clientOf, dialects, quiet, quietly } from './transactional.test_shared.ts'

const organizer = { _tag: 'Organizer' } as const
const gig = { flags: { capacity: 10 }, requestId: 'c-gig', sender: organizer }
const b1 = { flags: { customer: 'ann', event: 'gig', seats: 3 }, requestId: 'c-b1', sender: { _tag: 'Customer', id: 'ann' } } as const

/** A failure of the database, as a statement or a commit gives it. */
const failure = new SqlError.SqlError({
  reason: new SqlError.UnknownError({ cause: null, message: 'the write failed' }),
})

/** A retry so long that a hold answered within a test was woken by something other than the clock. */
const hour = { retry: { millis: 3_600_000 } }

/** A process: a runtime launched in a scope of its own, which `die` closes as a crash does. */
const launched = (options?: Options) =>
  Effect.gen(function*() {
    const scope = yield* Scope.make()
    const runtime = yield* Effect.provideService(launch(options), Scope.Scope, scope)
    const deploy = <T extends Types>(program: Program<T>) => runtime.deploy(program)
    return { deploy, die: Scope.close(scope, Exit.void) }
  })

/** Runs `body` on a new database of each dialect, and gives what it gave on each. */
const run = async <A>(body: Effect.Effect<A, never, SqlClient.SqlClient>): Promise<Array<A>> => {
  const results: Array<A> = []
  await onEach(dialects, async (dialect) => {
    results.push(
      await Effect.runPromise(body.pipe(Effect.provide([clientOf(dialect), TestClock.layer()]), quietly)),
    )
  })
  return results
}

/** An inventory that dies on a hold while `broken.now` holds, so an operator mends it in place, with no deploy. */
const breakable = (broken: { now: boolean }): typeof inventory => ({
  ...inventory,
  update: (message, meta) =>
    broken.now && message._tag === 'HoldRequested' ? () => defect('broken') : inventory.update(message, meta),
})

const statusOf = (read: Effect.Effect<{ status: string } | null>) => Effect.map(read, (found) => found?.status)
const availableIn = (read: Effect.Effect<{ available: number } | null>) => Effect.map(read, (found) => found?.available)

test('a hold the suspended inventory has no reply to is answered once an operator resumes the inventory', () =>
  run(Effect.gen(function*() {
    const broken = { now: true }
    const { deploy, die } = yield* launched(hour)
    const inventories = yield* deploy(breakable(broken))
    const bookings = yield* deploy(booking)
    yield* inventories.create('gig', gig)
    yield* bookings.create('b1', b1)
    yield* quiet
    expect(yield* statusOf(bookings.read('b1'))).toBe('Holding')
    broken.now = false
    expect(yield* inventories.resume('gig')).toEqual({ _tag: 'Resumed' })
    yield* quiet
    expect(yield* statusOf(bookings.read('b1'))).toBe('Held')
    expect(yield* availableIn(inventories.read('gig'))).toBe(7)
    yield* die
  })))

test('a resumption between the answer Suspended and the wait of the hold ends the wait', () =>
  run(Effect.gen(function*() {
    const broken = { now: true }
    // Once armed, the probe resumes the inventory right after the transaction that suspended it commits, and before
    // the hold is given `Suspended`.
    let resumeNext: Effect.Effect<unknown> | null = null
    const { deploy, die } = yield* launched({
      ...hour,
      probe: (point, entity) =>
        Effect.suspend(() => {
          const resumption = resumeNext
          if (point !== 'AfterCommit' || entity.name !== 'Inventory' || resumption === null) return Effect.void
          resumeNext = null
          broken.now = false
          return Effect.asVoid(resumption)
        }),
    })
    const inventories = yield* deploy(breakable(broken))
    const bookings = yield* deploy(booking)
    yield* inventories.create('gig', gig)
    resumeNext = inventories.resume('gig')
    yield* bookings.create('b1', b1)
    yield* quiet
    expect(resumeNext).toBeNull()
    expect(yield* statusOf(bookings.read('b1'))).toBe('Held')
    yield* die
  })))

test('a hold whose inventory another process resumes sends again at the retry, and is answered', () =>
  run(Effect.gen(function*() {
    const retry = { millis: 100 }
    const first = yield* launched({ retry })
    const inventories = yield* first.deploy(breakable({ now: true }))
    const bookings = yield* first.deploy(booking)
    yield* inventories.create('gig', gig)
    yield* bookings.create('b1', b1)
    yield* quiet
    // The other process resumes the inventory with the mended program. Nothing tells the first one so.
    const second = yield* launched()
    expect(yield* (yield* second.deploy(inventory)).resume('gig')).toEqual({ _tag: 'Resumed' })
    yield* quiet
    yield* TestClock.adjust(retry.millis - 1)
    yield* quiet
    expect(yield* statusOf(bookings.read('b1'))).toBe('Holding')
    yield* TestClock.adjust(1)
    yield* quiet
    expect(yield* statusOf(bookings.read('b1'))).toBe('Held')
    expect(yield* availableIn(inventories.read('gig'))).toBe(7)
    yield* second.die
    yield* first.die
  })))

test('a hold whose inventory is not deployed yet is answered once the inventory is deployed', () =>
  run(Effect.gen(function*() {
    const before = yield* launched()
    yield* (yield* before.deploy(inventory)).create('gig', gig)
    yield* before.die
    const { deploy, die } = yield* launched(hour)
    const bookings = yield* deploy(booking)
    yield* bookings.create('b1', b1)
    yield* quiet
    expect(yield* statusOf(bookings.read('b1'))).toBe('Holding')
    const inventories = yield* deploy(inventory)
    yield* quiet
    expect(yield* statusOf(bookings.read('b1'))).toBe('Held')
    expect(yield* availableIn(inventories.read('gig'))).toBe(7)
    yield* die
  })))

test('a hold whose transaction of the inventory fails in the database sends again at the retry, unsuspended', () =>
  run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const retry = { millis: 100 }
    const attempts: Array<number> = []
    let fails = false
    const { deploy, die } = yield* launched({
      retry,
      // Once armed, the first transaction of the inventory fails as a write that fails before the commit.
      probe: (point, entity) =>
        point !== 'BeforeCommit' || entity.name !== 'Inventory' || attempts.length === 0 && !fails
          ? Effect.void
          : Effect.flatMap(Clock.currentTimeMillis, (now) => {
            attempts.push(now)
            if (!fails) return Effect.void
            fails = false
            return Effect.die(failure)
          }),
    })
    const inventories = yield* deploy(inventory)
    const bookings = yield* deploy(booking)
    yield* inventories.create('gig', gig)
    fails = true
    yield* bookings.create('b1', b1)
    yield* quiet
    expect(attempts).toHaveLength(1)
    expect(yield* statusOf(bookings.read('b1'))).toBe('Holding')
    expect(yield* storage(booking, sql).suspended).toEqual([])
    yield* TestClock.adjust(retry.millis - 1)
    yield* quiet
    expect(attempts).toHaveLength(1)
    yield* TestClock.adjust(1)
    yield* quiet
    expect(attempts).toEqual([0, retry.millis])
    expect(yield* statusOf(bookings.read('b1'))).toBe('Held')
    expect(yield* availableIn(inventories.read('gig'))).toBe(7)
    yield* die
  })))

/**
 * A probe that fails the `nth` transaction of the booking at its commit, once, and counts the booking's transactions
 * that reach their commit.
 */
const failingBooking = (nth: number) => {
  const reached = { count: 0 }
  const probe: Options['probe'] = (point, entity) =>
    Effect.suspend(() => {
      if (point !== 'BeforeCommit' || entity.name !== 'Booking') return Effect.void
      reached.count++
      return reached.count === nth ? Effect.die(failure) : Effect.void
    })
  return { reached, probe }
}

test('an operation whose end fails in the database is recorded at the retry', () =>
  run(Effect.gen(function*() {
    const retry = { millis: 100 }
    // The booking's first transaction creates it, and its second records the end of the hold.
    const { reached, probe } = failingBooking(2)
    const { deploy, die } = yield* launched({ retry, probe })
    const inventories = yield* deploy(inventory)
    const bookings = yield* deploy(booking)
    yield* inventories.create('gig', gig)
    yield* bookings.create('b1', b1)
    yield* quiet
    expect(reached.count).toBe(2)
    expect(yield* statusOf(bookings.read('b1'))).toBe('Holding')
    yield* TestClock.adjust(retry.millis)
    yield* quiet
    expect(reached.count).toBe(3)
    expect(yield* statusOf(bookings.read('b1'))).toBe('Held')
    expect(yield* availableIn(inventories.read('gig'))).toBe(7)
    yield* die
  })))

test('a timer whose fire fails in the database fires at the retry', () =>
  run(Effect.gen(function*() {
    const retry = { millis: 100 }
    // The third transaction of the booking fires the deadline, once the hold has ended.
    const { reached, probe } = failingBooking(3)
    const { deploy, die } = yield* launched({ retry, probe })
    const inventories = yield* deploy(inventory)
    const bookings = yield* deploy(booking)
    yield* inventories.create('gig', gig)
    yield* bookings.create('b1', b1)
    yield* quiet
    expect(yield* statusOf(bookings.read('b1'))).toBe('Held')
    yield* TestClock.adjust(15 * 60_000)
    yield* quiet
    expect(reached.count).toBe(3)
    expect(yield* statusOf(bookings.read('b1'))).toBe('Held')
    yield* TestClock.adjust(retry.millis)
    yield* quiet
    expect(yield* statusOf(bookings.read('b1'))).not.toBe('Held')
    yield* die
  })))

const hold = (seats: number) => ({ _tag: 'HoldRequested', seats }) as const

type Hold = Readonly<{ event: string; seats: number }>

/** A hold that sends `times` holds under the name `hold`, and reports the seats held. */
const sending = (times: number) => (op: Hold) =>
  Effect.gen(function*() {
    for (let at = 0; at < times; at++) yield* send(inventory, op.event, hold(op.seats), 'hold')
    return { _tag: 'SeatsHeld' } as const
  })

/** Runs one booking whose hold is `Hold`, and gives the cause its suspension shows and the seats left. */
const refused = (Hold: (typeof booking)['operations']['Hold']) =>
  run(Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const { deploy, die } = yield* launched()
    const inventories = yield* deploy(inventory)
    const bookings = yield* deploy({ ...booking, operations: { ...booking.operations, Hold } })
    yield* inventories.create('gig', gig)
    yield* bookings.create('b1', b1)
    yield* quiet
    const suspended = yield* storage(booking, sql).suspended
    const available = yield* availableIn(inventories.read('gig'))
    yield* die
    return { causes: suspended.map(({ cause }) => cause), available }
  }))

test('a droppable operation that sends dies, and suspends its entity', async () => {
  // The types refuse a droppable operation that sends, so only a program typed by hand reaches the runtime's check.
  const dropping = operation.droppable(sending(1) as unknown as (op: Hold) => Effect.Effect<{ _tag: 'SeatsHeld' }>)
  for (const { causes, available } of await refused(dropping as unknown as (typeof booking)['operations']['Hold'])) {
    expect(causes).toHaveLength(1)
    expect(causes[0]).toContain("the droppable operation under 'hold' sent to Inventory 'gig'")
    expect(available).toBe(10)
  }
})

test('an operation that sends twice under a name to an entity dies at the second, and suspends its entity', async () => {
  for (const { causes, available } of await refused(operation.atLeastOnce(sending(2)))) {
    expect(causes).toHaveLength(1)
    expect(causes[0]).toContain("the operation sent 'hold' to Inventory 'gig' twice")
    expect(available).toBe(7)
  }
})

/** An inventory whose creation `init` rejects where its capacity is 0. */
const gated: typeof inventory = {
  ...inventory,
  init: (flags, at) => flags.capacity === 0 ? rejectWith('SoldOut') : inventory.init(flags, at),
}

/**
 * A hold that sends to the inventory, after it creates it with no seats where `creates` is true. While
 * `holding.now` is true, the hold never ends once it is answered, so that its process dies with it under way.
 */
const crashing = (holding: { now: boolean }, creates: boolean) => (op: Hold) =>
  Effect.gen(function*() {
    const made = creates ? yield* create(gated, op.event, 'make', { capacity: 0 }) : null
    const reply = made?._tag === 'Rejected' ? made : yield* send(gated, op.event, hold(op.seats), 'hold')
    if (holding.now) yield* Effect.never
    return reply._tag === 'Accepted'
      ? { _tag: 'SeatsHeld' } as const
      : { _tag: 'SeatsUnavailable', reason: reply._tag === 'NotFound' ? 'NoSuchEvent' : 'SoldOut' } as const
  })

/**
 * Runs a hold of `crashing` to its answer in a process that then dies. The inventory is created before the hold
 * where `before` is true, and after the hold's answer otherwise. A second process runs the hold again, and this
 * gives the booking's status and the seats left.
 */
const afterCrash = (creates: boolean, before: boolean) =>
  run(Effect.gen(function*() {
    const holding = { now: true }
    const program = { ...booking, operations: { ...booking.operations, Hold: operation.atLeastOnce(crashing(holding, creates)) } }
    const first = yield* launched()
    const inventories = yield* first.deploy(gated)
    const bookings = yield* first.deploy(program)
    if (before) yield* inventories.create('gig', gig)
    yield* bookings.create('b1', b1)
    yield* quiet
    if (!before) expect(yield* inventories.create('gig', gig)).toEqual({ _tag: 'Created' })
    yield* first.die
    holding.now = false
    const second = yield* launched()
    const mended = yield* second.deploy(gated)
    const again = yield* second.deploy(program)
    yield* quiet
    const found = { status: yield* statusOf(again.read('b1')), available: yield* availableIn(mended.read('gig')) }
    yield* second.die
    return found
  }))

test('a hold run again after a crash sends the same request, and is given the reply the inventory stored', async () => {
  expect(await afterCrash(false, true)).toEqual(dialects.map(() => ({ status: 'Held', available: 7 })))
})

test('a hold run again after a crash is given the NotFound of its first run, though the inventory exists since', async () => {
  expect(await afterCrash(false, false)).toEqual(dialects.map(() => ({ status: 'Cancelled', available: 10 })))
})

test('a hold run again after a crash is given the rejection of its first creation, though another made it since', async () => {
  expect(await afterCrash(true, false)).toEqual(dialects.map(() => ({ status: 'Cancelled', available: 10 })))
})
