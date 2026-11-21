/**
 * The runtime on the transaction. It keeps one rule: every event is one transaction that reads the entity under a
 * lock, steps `Machine.step` from what it read, and writes. No entity is held in memory. The process holds the
 * fibers of the operations that run. It also remembers the entities it has activated, at most `remembered` of them,
 * and it may forget one at no cost but an activation.
 *
 * A reading that steps nothing, as `query` or `inspect`, reads the storage outside any lock of an entity.
 */
import * as Cause from 'effect/Cause'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Option from 'effect/Option'
import * as Queue from 'effect/Queue'
import type * as Scope from 'effect/Scope'
import { SqlClient, SqlError } from 'effect/sql'
import * as Machine from './machine.ts'
import {
  type Address,
  checkProgram,
  type Creation,
  encode,
  Entities,
  type Flagged,
  type FlagsOf,
  idFault,
  InvariantDefect,
  isTimer,
  type Key,
  type Piece,
  type Program,
  type Receiver,
  type Reply,
  type Request,
  requestIdFault,
  type Reused,
  runnerOf,
  type SenderOf,
  type Types,
} from './program.ts'
import {
  createTables,
  type Found,
  type Query,
  type Reindexed,
  type Storage,
  storage,
  type Suspended,
  transaction,
} from './storage.ts'

/**
 * What a caller is answered: the replies stored under its request id, `NotFound` for no entity, or `Suspended`,
 * which says that the request has no reply yet.
 */
export type Answer<Reason> = Reply<Reason> | Readonly<{ _tag: 'Suspended' }> | Reused

/**
 * An entity, as `Handle.inspect` gives it: what is stored of it, read through the migrations as a step reads it,
 * from one snapshot outside a transaction the caller left open, and at the caller's level within one.
 */
export type Inspected<T extends Types> = Readonly<{
  id: string
  state: T['state']
  /**
   * The messages queued for the entity, the next one first: an inbound one with the request it came with, an internal
   * one with the run of the work that sent it.
   */
  mailbox: ReadonlyArray<
    | Readonly<{ _tag: 'Inbound'; request: Request<T['sender']>; message: T['inbound'] }>
    | Readonly<{ _tag: 'Internal'; key: Key; incarnation: number; message: T['internal'] }>
  >
  /**
   * The work under way, the oldest first: each key the state holds work under, its incarnation, and the operation or
   * the timer.
   */
  work: ReadonlyArray<Readonly<{ key: Key; incarnation: number; work: Piece<T['operation'], T['internal']> }>>
  /** The suspension, as `suspended` lists it, or null for an entity that is not suspended. */
  suspension: Suspended | null
}>

/** What an operator's `resume` or `discard` did. */
export type Operated =
  /** The entity was stepped again: the message it died on is handled next, by the program deployed. */
  | Readonly<{ _tag: 'Resumed' }>
  /** The inbound message the entity died on was dropped, and the entity stepped again. */
  | Readonly<{ _tag: 'Discarded' }>
  /** The entity died on an internal message, in an operation or on its activation, and none is discarded. */
  | Readonly<{ _tag: 'NotDiscarded' }>
  /** The program deployed dies on the stored state too, with this cause. A discard then keeps its message. */
  | Readonly<{ _tag: 'StillSuspended'; cause: string }>
  | Readonly<{ _tag: 'NotSuspended' }>
  | Readonly<{ _tag: 'NotFound' }>

/** How long a caller's reply is kept from the step that answers: `millis`, a non-negative integer, or `'forever'`. */
export type Keep = Readonly<{ millis: number }> | 'forever'

/**
 * A point of an event's transaction where a test stops the process, to see what a crash there leaves. `Recorded` is
 * inside the transaction, after an event queued a message and before the message is handled. `BeforeCommit` is at
 * the transaction's end, and `AfterCommit` is after the commit and before the process starts the work it stored.
 */
export type Point = 'Recorded' | 'BeforeCommit' | 'AfterCommit'

/** What a launch takes. */
export interface Options {
  /**
   * How long an operation waits before it sends again to a receiver that has no reply yet: a positive integer of
   * milliseconds, 50 by default. A receiver resumed in this process ends the wait sooner.
   */
  readonly retry?: Readonly<{ millis: number }>
  /**
   * How often the runtime runs `expire` on each program deployed: every `millis`, a positive integer, 300 000 by
   * default. `'none'` leaves `expire` to an operator. A sweep that fails logs a warning with its cause, and the next
   * one runs at the next interval.
   */
  readonly sweep?: Readonly<{ millis: number }> | 'none'
  /** What runs at each point of an event's transaction, given the entity of the event: a test's hook. */
  readonly probe?: (point: Point, entity: Address) => Effect.Effect<void>
}

/**
 * How many entities a process remembers it activated. An entity with no operation in this process is activated by
 * the program deployed in its first transaction of the process, as after a crash. One forgotten is activated again,
 * which writes nothing where its stored work agrees with the program, so the bound costs time and never a rule.
 */
const remembered = 10_000

/**
 * What a caller does with one program's entities. An id that is empty or no text a database holds is the caller's
 * defect. So is a request id that is no text a database holds, and a `keep` that is no non-negative integer of
 * milliseconds. Nothing is read or stored for a call refused.
 */
export interface Handle<T extends Types> {
  /**
   * Creates the entity `id` with the request's `flags`, left out where the program's flags are `null`. A retry of the
   * request that created it is answered `Created`. A request under the same sender and request id with other flags
   * is answered `Reused`, and changes nothing. Flags the program's `init` rejects are answered `Rejected`, and nothing
   * is stored, so a retry runs `init` again. A request id that is no text a database holds is the caller's defect. A
   * call within a transaction of the runtime's client is the caller's defect too, since its step commits on a
   * connection of its own.
   */
  readonly create: (
    id: string,
    request: Readonly<{ requestId: string } & FlagsOf<T> & SenderOf<T>>,
  ) => Effect.Effect<Creation<T['rejection']> | Reused>
  /**
   * Sends an inbound message, and gives its reply. A retry under the same request id gets the reply stored for it. A
   * request under the same sender and request id that carries another message is answered `Reused`, and nothing of
   * it is applied or stored. The boundary gives `keep`, the time its protocol retries for. The reply is kept for
   * `keep.millis` from the step that answers, and a retry after that is a new request. `'forever'` keeps the reply
   * for ever. A `keep.millis` that is no non-negative integer, or a request id that is no text a database holds, is
   * the caller's defect. A call within a transaction of the runtime's client is the caller's defect, as for `create`.
   */
  readonly send: (
    id: string,
    message: T['inbound'],
    request: Readonly<{ requestId: string; keep: Keep } & SenderOf<T>>,
  ) => Effect.Effect<Answer<T['rejection']>>
  /** What callers read of the entity `id`, or null when there is none. */
  readonly read: (id: string) => Effect.Effect<T['projection'] | null>
  /**
   * What callers read of the entities whose indexes match, at most `query.limit` of them, as `Handle.query` of the
   * library gives it. A query that is no object, or a limit that is no non-negative integer, is the caller's defect.
   */
  readonly query: (query: Query<T>) => Effect.Effect<ReadonlyArray<Found<T>>>
  /**
   * Writes the read model of every entity of the program again from its stored state, as `Handle.reindex` of the
   * library does. A row is written only where the state it was computed from is still the one stored, so it takes no
   * lock of an entity.
   */
  readonly reindex: Effect.Effect<Reindexed>
  /**
   * Deletes the callers' replies past their time, and the replies and the answers kept for work that has ended, and
   * gives how many went. No step reads them again. The sweep runs it at an interval.
   */
  readonly expire: Effect.Effect<number>
  /** The suspended entities of the program, the longest suspended first, read from what is stored. */
  readonly suspended: Effect.Effect<ReadonlyArray<Suspended>>
  /**
   * What is stored of the entity `id`, read from one snapshot, or null when there is none. It steps nothing and
   * activates nothing, so an operator reads it to decide between `resume` and `discard`.
   */
  readonly inspect: (id: string) => Effect.Effect<Inspected<T> | null>
  /** Resumes the suspended entity `id`, and says what the resumption did. */
  readonly resume: (id: string) => Effect.Effect<Operated>
  /** Discards the inbound message the suspended entity `id` died on, and says what the discard did. */
  readonly discard: (id: string) => Effect.Effect<Operated>
}

/** A runtime launched on one client. */
export interface Runtime {
  /**
   * Deploys a program with its services, restarts the operations a crash interrupted, and gives its handle. With
   * `outbox: true`, each creation of an entity and each step that changes its projection writes a row of
   * `effecttea_outbox` in the step's transaction. Without it, no row is written. The library never deletes a row
   * of the outbox: its reader deletes the rows it handled.
   */
  readonly deploy: <T extends Types>(
    program: Program<T>,
    options?: Readonly<{ outbox?: boolean }>,
  ) => Effect.Effect<Handle<T>, never, Exclude<T['services'], Entities>>
  /** Ends once no operation runs in this process and no stored timer is due. */
  readonly settled: Effect.Effect<void>
}

/**
 * What drives a process in place of its fibers and its waker, as a rehearsal does. A driven process forks no
 * operation, and fires no timer by itself.
 */
export interface Driver {
  /** A run a committed step stored, which the process holds as under way, with no fiber. */
  readonly started: (entity: Address, started: Extract<Machine.Output<Types>, Readonly<{ _tag: 'Started' }>>) => void
  /** A committed step suspended the entity with `cause`. */
  readonly suspended: (entity: Address, cause: unknown) => void
  /** The deployment of a program that a run sends to and the process does not run, or a defect. */
  readonly deploy: (program: Receiver<any>) => Effect.Effect<Deployment<any>>
}

/**
 * The defect of a run of a driven process whose receiver has no reply yet. A launched process sends again after its
 * retry, and a driven one would wait for ever, so the run ends with this defect, and no step records it.
 */
export class Unanswered extends Error {
  readonly _tag = 'Unanswered'
}

export interface Deployment<T extends Types> {
  readonly program: Program<T>
  readonly storage: Storage<T>
  /** Gives an operation the services the program was deployed with. */
  readonly provide: (operation: Effect.Effect<void, never, T['services']>) => Effect.Effect<void>
  /** Wakes the fiber that fires the stored timers, once a step arms one due before the time it sleeps until. */
  readonly poke: Queue.Queue<void>
  /** The time the fiber that fires the timers sleeps until, in milliseconds, or null where it waits for a poke. */
  next: number | null
}

interface Process {
  readonly sql: SqlClient.SqlClient
  readonly retry: number
  readonly probe: (point: Point, entity: Address) => Effect.Effect<void>
  readonly scope: Scope.Scope
  readonly driver: Driver | undefined
  // The types of each deployment are those of its program, which a map by name cannot say.
  readonly deployments: Map<string, Deployment<any>>
  /**
   * The operations that run in this process, by entity and by run: all the process holds of an entity. A run's fiber
   * is null from the transaction that stores the run until the process starts the fiber after the commit.
   */
  readonly operations: Map<string, Map<string, Fiber.Fiber<void> | null>>
  /**
   * The entities this process activated, the most recently stepped last, at most `remembered` of them. A set keeps
   * the order its addresses were added in, which is all the bound needs: Effect's `Cache` computes values through an
   * effect, and this holds none.
   */
  readonly activated: Set<string>
  /** Done when an operation ends in this process or a timer fires, and then made anew: what `settled` waits on. */
  changed: Deferred.Deferred<void>
  /** Done when an entity is resumed or a program deployed, and then made anew: what a sender's retry waits on. */
  resumed: Deferred.Deferred<void>
}

const addressOf = (entity: Address) => JSON.stringify([entity.name, entity.id])

/** The run of the work under `key` in `incarnation`, as the process names an operation's fiber. */
const under = (key: Key, incarnation: number) => `${Machine.keyText(key)}@${incarnation}`

const tell = (p: Process, signal: 'changed' | 'resumed') => {
  const was = p[signal]
  p[signal] = Deferred.makeUnsafe<void>()
  Deferred.doneUnsafe(was, Effect.void)
}

/** Forgets the run of an operation that ended, and its entity once no operation of the entity runs. */
const release = (p: Process, address: string, run: string) => {
  const runs = p.operations.get(address)
  if (runs === undefined) return
  runs.delete(run)
  if (runs.size === 0) p.operations.delete(address)
}

/**
 * `effect` without the transaction of the fiber that forks it. A caller may call within a transaction of its own,
 * and a fiber that kept it would run its statements on the caller's connection.
 */
const untransacted = <A>(sql: SqlClient.SqlClient, effect: Effect.Effect<A>) =>
  Effect.updateContext(effect, (services: Context.Context<never>) => Context.omit(sql.transactionService)(services))

/**
 * Forks `effect` in the process's scope, `untransacted`, as a fiber that can be interrupted. A fork stands inside
 * the region of `inEntity` that no interruption divides, and the option keeps the fiber interruptible there, so
 * that the scope's closing stops it.
 */
const apart = <A>(p: Process, effect: Effect.Effect<A>) =>
  Effect.forkIn(untransacted(p.sql, effect), p.scope, { uninterruptible: false })

/** Remembers that the process activated the entity, and forgets the one stepped least recently past the bound. */
const remember = (p: Process, address: string) => {
  p.activated.delete(address)
  p.activated.add(address)
  if (p.activated.size <= remembered) return
  const oldest = p.activated.values().next()
  if (oldest.done !== true) p.activated.delete(oldest.value)
}

/**
 * What the process is doing for an entity, derived from what is stored and from the fibers of this process. A
 * stored timer is armed unless its entity is suspended. The waker reads the due timers before it takes the lock, so
 * the entity it fires may have suspended since. A stored operation runs where this process holds its fiber. `lost`
 * says whether a stored operation has no fiber in this process, as after a crash. Work whose message waits in the
 * mailbox needs no check of its own. Each transaction handles the mailbox until it is empty or the entity is
 * suspended, and a suspended entity arms no timer and is not restarted.
 */
const runningOf = <T extends Types>(p: Process, address: string, stored: Machine.Stored<T>) => {
  const runs = p.operations.get(address)
  const running: Record<string, Machine.Running> = {}
  let lost = false
  for (const [text, { key, incarnation, work }] of Object.entries(stored.keys)) {
    if (isTimer(work)) {
      if (stored.suspension === null) running[text] = { kind: 'Timer', incarnation }
    } else if (runs?.has(under(key, incarnation)) === true) running[text] = { kind: 'Operation', incarnation }
    else lost = true
  }
  return { running, lost }
}

/** What an event's transaction is given: the entity as it read it, and how to step an event of it. */
export interface Transaction<T extends Types> {
  /** The entity as the transaction read it and as its events left it, or null where none is stored. */
  machine: Machine.Machine<T> | null
  /** The time of the transaction, read once. */
  readonly now: DateTime.Utc
  /** What the machine gave for the events stepped so far. */
  readonly outputs: Array<Machine.Output<T>>
  /**
   * Steps an event and writes what it gives, then handles the mailbox until it is empty or the entity is suspended.
   * It gives the entity as the event left it, before the mailbox was handled.
   */
  readonly apply: (event: Machine.Event<T>) => Effect.Effect<Machine.Machine<T>>
  /** Writes the entity a creation started. */
  readonly created: (started: Extract<Machine.Start<T>, Readonly<{ _tag: 'Created' }>>) => Effect.Effect<void>
}

/**
 * One transaction of the entity `id`, and then what the process does for what the transaction stored. The
 * transaction takes the entity's lock as it begins, reads the time and the entity, runs `body` and commits. The time
 * is read after the lock, so that a transaction that waited for another steps at the time it holds the entity. An
 * entity that is not suspended is restarted first where one of its operations has no fiber in this process, which
 * runs the operation again as after a crash. It is restarted too where it has no operation here and the process does
 * not remember activating it: the restart then checks the stored work against the program deployed, and writes
 * nothing where the two agree.
 */
const inEntity = <T extends Types, A>(
  p: Process,
  d: Deployment<T>,
  id: string,
  body: (tx: Transaction<T>) => Effect.Effect<A>,
): Effect.Effect<A> =>
  Effect.suspend(() => {
    const entity: Address = { name: d.program.name, id }
    const address = addressOf(entity)
    const outputs: Array<Machine.Output<T>> = []
    const claimed: Array<string> = []
    let woken = false
    const stepped = Effect.gen(function*() {
      yield* d.storage.lock(id)
      const now = yield* DateTime.now
      const millis = DateTime.toEpochMillis(now)
      const stored = yield* d.storage.load(id)
      const write = (moved: Machine.Transition<T>) =>
        Effect.gen(function*() {
          tx.machine = moved.machine
          outputs.push(...moved.outputs)
          if (moved.written !== null) yield* d.storage.write(id, moved.written, millis)
          if (moved.written?.woken === true) woken = true
          return moved.machine
        })
      const held = stored === null ? null : runningOf(p, address, stored)
      const tx: Transaction<T> = {
        machine: stored === null || held === null ? null : { stored, running: held.running },
        now,
        outputs,
        apply: (event) =>
          Effect.gen(function*() {
            if (tx.machine === null) return yield* Effect.die(new Error(`an event of '${id}', which is not stored`))
            const after = yield* write(Machine.step(d.program, tx.machine, event))
            let machine = after
            while (machine.stored.suspension === null && machine.stored.mailbox.length > 0) {
              yield* p.probe('Recorded', entity)
              machine = yield* write(Machine.step(d.program, machine, { _tag: 'Handle', at: now }))
            }
            return after
          }),
        created: (started) => Effect.asVoid(write(started)),
      }
      const unseen = !p.operations.has(address) && !p.activated.has(address)
      if (stored !== null && stored.suspension === null && (held?.lost === true || unseen)) {
        yield* tx.apply({ _tag: 'Restart' })
      }
      const result = yield* body(tx)
      // The runs the transaction stored are claimed before the commit. Another transaction of the entity may begin
      // between the commit and the fork of the fibers, and would otherwise restart the entity as after a crash.
      const runs = p.operations.get(address) ?? new Map<string, Fiber.Fiber<void> | null>()
      for (const output of outputs) {
        if (output._tag !== 'Started') continue
        const run = under(output.key, output.incarnation)
        runs.set(run, null)
        claimed.push(run)
      }
      if (runs.size > 0) p.operations.set(address, runs)
      yield* p.probe('BeforeCommit', entity)
      return result
    })
    const unclaim = Effect.sync(() => claimed.forEach((run) => release(p, address, run)))
    // The commit and what follows it are one region no interruption divides, so that a caller that gives up after
    // the commit still leaves the stored operations running.
    return Effect.uninterruptible(Effect.gen(function*() {
      const result = yield* transaction(p.sql, stepped).pipe(Effect.onError(() => unclaim), Effect.orDie)
      yield* p.probe('AfterCommit', entity)
      remember(p, address)
      for (const output of outputs) {
        if (output._tag === 'Started') {
          const run = under(output.key, output.incarnation)
          const runs = p.operations.get(address)
          if (runs?.has(run) !== true) continue
          if (p.driver === undefined) runs.set(run, yield* apart(p, operating(p, d, id, output)))
          else p.driver.started(entity, output)
        } else if (output._tag === 'Suspended') p.driver?.suspended(entity, output.cause)
        else if (output._tag === 'Disarmed') {
          // A droppable operation the step dropped or changed stops. A timer has no fiber.
          const run = under(output.key, output.incarnation)
          const fiber = p.operations.get(address)?.get(run)
          if (fiber === undefined) continue
          release(p, address, run)
          if (fiber !== null) yield* apart(p, Fiber.interrupt(fiber))
        } else if (output._tag === 'Armed') {
          const at = DateTime.toEpochMillis(output.timer.at)
          if (d.next === null || at < d.next) yield* Queue.offer(d.poke, undefined)
        }
      }
      // A sender that was answered `Suspended` sends again once an entity leaves its suspension.
      if (woken) tell(p, 'resumed')
      return result
    }))
  })

/**
 * The fiber of one run of an operation. It runs the operation with the program's services, and then steps its
 * completion or its death in a transaction of the entity. An operation that was only interrupted records nothing:
 * its step dropped it, or the process is stopping.
 */
const operating = <T extends Types>(
  p: Process,
  d: Deployment<T>,
  id: string,
  started: Extract<Machine.Output<T>, Readonly<{ _tag: 'Started' }>>,
): Effect.Effect<void> => {
  const entity: Address = { name: d.program.name, id }
  const { key, incarnation, operation } = started
  const runner = runnerOf(d.program, operation)
  if (runner === undefined) return Effect.die(new Error(`no runner for the operation under '${Machine.shownKey(key)}'`))
  const ran = runner.delivery === 'Idempotent' || runner.delivery === 'IdempotentDigest'
    ? runner.run(operation, started.idempotencyKey)
    : runner.run(operation)
  const sending = entitiesOf(p, entity, key, incarnation, runner.delivery === 'Droppable')
  const recorded = Effect.flatMap(
    Effect.exit(Effect.provideService(ran, Entities, sending)),
    (exit): Effect.Effect<unknown> =>
      Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)
        ? Effect.void
        : persisting(p, inEntity(p, d, id, (tx) =>
          tx.apply(Exit.isSuccess(exit)
            ? { _tag: 'Complete', key, incarnation, message: exit.value }
            : { _tag: 'Die', key, incarnation, cause: Cause.squash(exit.cause) }))),
  )
  return d.provide(Effect.asVoid(recorded) as Effect.Effect<void, never, T['services']>).pipe(
    Effect.ensuring(Effect.sync(() => {
      release(p, addressOf(entity), under(key, incarnation))
      tell(p, 'changed')
    })),
  )
}

/** Whether `cause` is a statement or a commit that failed, which the storage gives as a defect of `SqlError`. */
const failedInDatabase = (cause: Cause.Cause<never>) =>
  !Cause.hasInterrupts(cause) && SqlError.isSqlError(Cause.squash(cause))

/** Logs a transaction that failed in the database and is tried again, with its cause. */
const retried = (cause: Cause.Cause<never>) =>
  Effect.logWarning('a transaction failed in the database; it is tried again after the retry', cause)

/**
 * Runs the transaction `effect` again after `retry` while it fails in the database, as a deadlock fails it on
 * PostgreSQL. It records an operation's end, which only the operation's fiber holds, so a failure must not lose it.
 * A commit that failed may have committed, and the event run again is then one the machine ignores.
 */
const persisting = <A>(p: Process, effect: Effect.Effect<A>): Effect.Effect<A> =>
  Effect.catchCauseIf(
    effect,
    failedInDatabase,
    (cause) => Effect.andThen(retried(cause), Effect.andThen(Effect.sleep(`${p.retry} millis`), persisting(p, effect))),
  )

/** The last output of a transaction that `pick` reads an answer from. */
const answerOf = <T extends Types, A>(tx: Transaction<T>, pick: (output: Machine.Output<T>) => A | undefined): A => {
  for (let at = tx.outputs.length - 1; at >= 0; at--) {
    const output = tx.outputs[at]
    const answer = output === undefined ? undefined : pick(output)
    if (answer !== undefined) return answer
  }
  throw new Error('the transaction of a request gave no answer to it')
}

const send = <T extends Types>(
  p: Process,
  d: Deployment<T>,
  id: string,
  message: T['inbound'],
  request: Request<T['sender']>,
  keep?: number,
): Effect.Effect<Answer<T['rejection']>> =>
  Effect.gen(function*() {
    // A message or a sender that does not encode is its caller's defect, and reaches no entity.
    const asked = yield* Effect.sync(() => {
      encode(d.program.schemas.inbound, message, 'inbound message')
      if (request._tag === 'Caller') encode(d.program.schemas.sender, request.sender, 'sender')
      return Machine.requestKey(d.program, request)
    })
    // An operation is given again the `NotFound` a run before it was given, so that a run after a crash acts alike.
    if (request._tag === 'Operation') {
      const kept = yield* d.storage.answer(id, 'Message', request)
      if (kept?._tag === 'NotFound') return kept
    }
    return yield* inEntity(p, d, id, (tx): Effect.Effect<Answer<T['rejection']>> =>
      Effect.gen(function*() {
        if (tx.machine === null) {
          const none = { _tag: 'NotFound' } as const
          if (request._tag === 'Operation') yield* d.storage.keepAnswer(id, 'Message', request, none)
          return none
        }
        const found = yield* d.storage.reply(id, request, DateTime.toEpochMillis(tx.now))
        yield* tx.apply({
          _tag: 'Receive',
          request,
          message,
          reply: found?.reply ?? null,
          carried: found?.carried ?? null,
          at: tx.now,
          ...(keep === undefined ? {} : { keep }),
        })
        return answerOf(tx, (output) =>
          output._tag === 'Replied' && Machine.requestKey(d.program, output.request) === asked ? output.reply : undefined)
      }))
  })

const create = <T extends Types>(
  p: Process,
  d: Deployment<T>,
  id: string,
  flags: T['flags'],
  request: Request<T['sender']>,
): Effect.Effect<Creation<T['rejection']> | Reused> =>
  Effect.gen(function*() {
    const asked = yield* Effect.sync(() => {
      encode(d.program.schemas.flags, flags, 'value of the flags')
      if (request._tag === 'Caller') encode(d.program.schemas.sender, request.sender, 'sender')
      return Machine.requestKey(d.program, request)
    })
    if (request._tag === 'Operation') {
      const kept = yield* d.storage.answer(id, 'Create', request)
      if (kept?._tag === 'Rejected') return kept
    }
    return yield* inEntity(p, d, id, (tx): Effect.Effect<Creation<T['rejection']> | Reused> =>
      Effect.gen(function*() {
        if (tx.machine === null) {
          const started = Machine.start(d.program, id, flags, tx.now, request)
          // A defect at creation stores nothing, and its creator is given the defect.
          if (started._tag === 'Defect') return yield* Effect.die(started.cause)
          if (started._tag === 'Rejected') {
            if (request._tag === 'Operation') yield* d.storage.keepAnswer(id, 'Create', request, started.reply)
            return started.reply
          }
          yield* tx.created(started)
        } else yield* tx.apply({ _tag: 'Create', request, flags })
        return answerOf(tx, (output) =>
          output._tag === 'CreationReplied' && Machine.requestKey(d.program, output.request) === asked
            ? output.reply
            : undefined)
      }))
  })

/** An operator's `Resume` or `Discard`, in one transaction, with what it did read off the entity around it. */
const operate = <T extends Types>(p: Process, d: Deployment<T>, id: string, event: 'Resume' | 'Discard') =>
  inEntity(p, d, id, (tx): Effect.Effect<Operated> =>
    Effect.gen(function*() {
      const before = tx.machine
      if (before === null) return { _tag: 'NotFound' }
      if (before.stored.suspension === null) return { _tag: 'NotSuspended' }
      const after = yield* tx.apply({ _tag: event })
      if (after.stored.suspension === null) return { _tag: event === 'Resume' ? 'Resumed' : 'Discarded' }
      if (after === before) return { _tag: 'NotDiscarded' }
      return { _tag: 'StillSuspended', cause: Machine.render(after.stored.suspension.cause) }
    }))


/**
 * What one run of an operation sends with. Its request is the run's, with the name the operation gives, so a run
 * after a crash sends the same requests and is given the stored replies. A receiver that is suspended, or whose
 * program is not deployed yet, has no reply: the run sends again after `retry`, or sooner once an entity is resumed
 * or a program deployed in this process. A transaction that failed in the database has no reply either, and the run
 * sends again after `retry`. Only a defect of the sender's own then suspends it.
 */
const entitiesOf = (p: Process, entity: Address, key: Key, incarnation: number, droppable: boolean) => {
  const used = new Set<string>()
  const requested = (kind: 'sent' | 'created', program: string, id: string, name: string) =>
    Effect.sync(() => {
      const refuse = (reason: string): never => {
        throw new InvariantDefect({ reason })
      }
      if (droppable) refuse(`the droppable operation under '${Machine.shownKey(key)}' sent to ${program} '${id}'`)
      const fault = idFault(id)
      if (fault !== undefined) refuse(fault)
      // A name used twice with one entity would be answered the first request's reply, and never applied.
      const to = JSON.stringify([kind, program, id, name])
      if (used.has(to)) refuse(`the operation ${kind} '${name}' to ${program} '${id}' twice`)
      used.add(to)
      return { _tag: 'Operation', entity, key, incarnation, name } as const
    })
  const answered = <A>(
    program: Receiver<any>,
    attempt: (d: Deployment<any>) => Effect.Effect<A | null>,
  ): Effect.Effect<A> =>
    Effect.suspend(() => {
      // The signal is taken before the attempt, so that a resumption between the answer and the wait ends the wait.
      const resumed = p.resumed
      const d = p.deployments.get(program.name)
      // A commit that failed may have committed, and the attempt sent again is then given the reply it stored.
      const attempted = d === undefined
        ? p.driver === undefined ? Effect.succeed(null) : Effect.flatMap(p.driver.deploy(program), attempt)
        : Effect.catchCauseIf(attempt(d), failedInDatabase, (cause) => Effect.as(retried(cause), null))
      return Effect.flatMap(attempted, (answer) =>
        answer !== null
          ? Effect.succeed(answer)
          : p.driver !== undefined
          ? Effect.die(new Unanswered(`a receiver of ${program.name} has no reply yet`))
          : Effect.flatMap(
            Effect.race(Deferred.await(resumed), Effect.sleep(`${p.retry} millis`)),
            () => answered(program, attempt),
          ))
    })
  const notReused = (program: string, id: string) =>
    Effect.die(new InvariantDefect({ reason: `an operation's request to ${program} '${id}' was answered Reused` }))
  return Entities.of({
    send: <T extends Types>(program: Receiver<T>, id: string, message: T['inbound'], name: string) =>
      Effect.flatMap(requested('sent', program.name, id, name), (request) =>
        answered(program, (d: Deployment<T>) =>
          Effect.flatMap(send(p, d, id, message, request), (reply): Effect.Effect<Reply<T['rejection']> | null> =>
            reply._tag === 'Suspended'
              ? Effect.succeed(null)
              : reply._tag === 'Reused'
              ? notReused(program.name, id)
              : Effect.succeed(reply)))),
    create: <T extends Types>(program: Receiver<T>, id: string, name: string, ...[flags]: Flagged<T>) =>
      Effect.flatMap(requested('created', program.name, id, name), (request) =>
        answered(program, (d: Deployment<T>) =>
          Effect.flatMap(
            create(p, d, id, flags === undefined ? null : flags, request),
            (creation): Effect.Effect<Creation<T['rejection']> | null> =>
              creation._tag === 'Reused' ? notReused(program.name, id) : Effect.succeed(creation),
          ))),
  })
}

/**
 * Fires the stored timers of a program's entities: the one fiber of a deployment that waits on time. It reads the
 * entities with a timer due, fires each timer in a transaction of its entity, and sleeps until the earliest time
 * stored, or until a step arms a timer before that time.
 */
const waking = <T extends Types>(p: Process, d: Deployment<T>): Effect.Effect<never> =>
  Effect.forever(Effect.gen(function*() {
    const now = yield* DateTime.now
    const due = yield* d.storage.due(DateTime.toEpochMillis(now))
    let fired = 0
    for (const id of due.ready) {
      // A fire that fails in the database fires nothing, and its timer is read again as one due and not fired.
      const fire = Effect.catchCauseIf(
        inEntity(p, d, id, (tx) =>
          Effect.gen(function*() {
            const next = tx.machine === null ? undefined : Machine.nextTimer(tx.machine, tx.now)
            if (next === undefined) return false
            yield* tx.apply({ _tag: 'Fire', key: next.key, incarnation: next.incarnation })
            return true
          })),
        failedInDatabase,
        (cause) => Effect.as(retried(cause), false),
      )
      while (yield* fire) fired++
    }
    tell(p, 'changed')
    if (fired > 0) return
    d.next = due.next
    // A timer that is due and did not fire is read again after `retry`, and not at once.
    const wait = due.ready.length > 0
      ? p.retry
      : due.next === null
      ? null
      : Math.max(0, due.next - DateTime.toEpochMillis(now))
    yield* Effect.race(Queue.take(d.poke), wait === null ? Effect.never : Effect.sleep(`${wait} millis`))
  }))

/**
 * Runs `expire` on a program's entities every `millis`, for ever. A sweep that fails is logged with its cause, and
 * the deployment goes on.
 */
const sweeping = <T extends Types>(d: Deployment<T>, millis: number): Effect.Effect<never> =>
  Effect.forever(Effect.andThen(
    Effect.sleep(`${millis} millis`),
    Effect.catchCause(expiring(d), (cause) =>
      Cause.hasInterruptsOnly(cause)
        ? Effect.failCause(cause)
        : Effect.logWarning('a sweep failed; the next one runs at the next interval', cause).pipe(
          Effect.annotateLogs({ name: d.program.name }),
        )),
  ))

const expiring = <T extends Types>(d: Deployment<T>) =>
  Effect.flatMap(DateTime.now, (now) => d.storage.expire(DateTime.toEpochMillis(now)))

/** What `inspect` gives of what the storage read: the work under way ordered by incarnation, the oldest first. */
const inspected = <T extends Types>(
  id: string,
  stored: Machine.Stored<T>,
  suspension: Suspended | null,
): Inspected<T> => ({
  id,
  state: stored.state,
  mailbox: stored.mailbox.map((envelope) =>
    envelope._tag === 'Inbound' ? { _tag: 'Inbound', request: envelope.request, message: envelope.message } : envelope
  ),
  work: Object.values(stored.keys)
    .map(({ key, incarnation, work }) => ({ key, incarnation, work }))
    .sort((one, other) => one.incarnation - other.incarnation),
  suspension,
})

/**
 * Runs `effect` on a query the caller gave, once it is an object whose limit is a non-negative integer. The types do
 * not hold a call from JavaScript, and a read of a field of no object would throw outside the effect.
 */
const asked = <T extends Types, A>(query: Query<T>, effect: Effect.Effect<A>): Effect.Effect<A> =>
  Effect.suspend(() => {
    if (typeof query !== 'object' || query === null) {
      return Effect.die(new InvariantDefect({ reason: `the query is ${String(query)}, which is no object` }))
    }
    if (!Number.isSafeInteger(query.limit) || query.limit < 0) {
      const reason = `the limit is ${query.limit}, which is no non-negative integer`
      return Effect.die(new InvariantDefect({ reason }))
    }
    return effect
  })

/**
 * Runs `effect` once the id and the request id a caller gave, where it gave one, are text a database holds, and the
 * id is not empty. Where `sql` is given, `effect` steps the entity, and a call within a transaction of the client is
 * refused too: the step would commit with the caller's transaction, after the process started the operations the
 * step stored. Anything refused is the caller's defect, and nothing is read or stored for it.
 */
const checked = <A>(
  id: string,
  requestId: string | null,
  effect: Effect.Effect<A>,
  sql?: SqlClient.SqlClient,
): Effect.Effect<A> =>
  Effect.flatMap(
    sql === undefined ? Effect.succeedNone : Effect.serviceOption(sql.transactionService),
    (open) => {
      const reason = idFault(id) ?? (requestId === null ? undefined : requestIdFault(requestId)) ??
        (Option.isSome(open) ? 'the call runs within a transaction of the client of the runtime' : undefined)
      return reason === undefined ? effect : Effect.die(new InvariantDefect({ reason }))
    },
  )

/** Whether `millis` is an integer of milliseconds of at least `least`. */
const isMillis = (millis: unknown, least: number): millis is number =>
  typeof millis === 'number' && Number.isSafeInteger(millis) && millis >= least

/** The time a caller's reply is kept, in milliseconds, or undefined for ever. Anything else is the caller's defect. */
const keptFor = (keep: Keep): number | undefined => {
  if (keep === 'forever') return undefined
  const millis = (keep as { millis?: unknown } | null | undefined)?.millis
  if (isMillis(millis, 0)) return millis
  throw new InvariantDefect({ reason: `the reply is kept ${JSON.stringify(keep)}, which is no non-negative integer of milliseconds` })
}

const processOf = (
  sql: SqlClient.SqlClient,
  scope: Scope.Scope,
  retry: number,
  probe: Options['probe'],
  driver: Driver | undefined,
): Process => ({
  sql,
  retry,
  probe: probe ?? (() => Effect.void),
  scope,
  driver,
  deployments: new Map(),
  operations: new Map(),
  activated: new Set(),
  changed: Deferred.makeUnsafe<void>(),
  resumed: Deferred.makeUnsafe<void>(),
})

/** Deploys `program` in the process, with no waker and no sweep, once it is checked. */
const deployed = <T extends Types>(
  p: Process,
  program: Program<T>,
  outbox: boolean,
  provide: Deployment<T>['provide'],
): Effect.Effect<Deployment<T>> =>
  Effect.gen(function*() {
    yield* Effect.sync(() => checkProgram(program))
    // A deploy steps the entities a crash interrupted, so it is refused within a transaction, as a call is.
    if (Option.isSome(yield* Effect.serviceOption(p.sql.transactionService))) {
      const reason = 'the deploy runs within a transaction of the client of the runtime'
      return yield* Effect.die(new InvariantDefect({ reason }))
    }
    if (p.deployments.has(program.name)) {
      return yield* Effect.die(new InvariantDefect({ reason: `the program '${program.name}' is deployed already` }))
    }
    const d: Deployment<T> = {
      program,
      storage: storage(program, p.sql, outbox),
      provide,
      poke: yield* Queue.sliding<void>(1),
      next: null,
    }
    yield* d.storage.indexed
    p.deployments.set(program.name, d)
    tell(p, 'resumed')
    return d
  })

/** The steps of a process that a driver runs by hand, as `rehearse` does, on the client given. */
export const drive = (sql: SqlClient.SqlClient, scope: Scope.Scope, driver: Driver) => {
  const p = processOf(sql, scope, 1, undefined, driver)
  return {
    deploy: <T extends Types>(program: Program<T>) =>
      deployed(p, program, false, (operation) => operation as Effect.Effect<void>),
    /** One transaction of the entity `id`, as every event of the runtime runs. */
    step: <T extends Types, A>(d: Deployment<T>, id: string, body: (tx: Transaction<T>) => Effect.Effect<A>) =>
      inEntity(p, d, id, body),
    send: <T extends Types>(
      d: Deployment<T>,
      id: string,
      message: T['inbound'],
      request: Request<T['sender']>,
      keep?: number,
    ) => send(p, d, id, message, request, keep),
    create: <T extends Types>(d: Deployment<T>, id: string, flags: T['flags'], request: Request<T['sender']>) =>
      create(p, d, id, flags, request),
    operate: <T extends Types>(d: Deployment<T>, id: string, event: 'Resume' | 'Discard') => operate(p, d, id, event),
    /** The process forgets the run, once its completion was stepped. */
    release: (entity: Address, key: Key, incarnation: number) => release(p, addressOf(entity), under(key, incarnation)),
    /** What the process runs of a stored entity, with no lock: the machine a step of it would start from. */
    machine: <T extends Types>(entity: Address, stored: Machine.Stored<T>): Machine.Machine<T> =>
      ({ stored, running: runningOf(p, addressOf(entity), stored).running }),
    entities: (entity: Address, key: Key, incarnation: number, droppable: boolean) =>
      entitiesOf(p, entity, key, incarnation, droppable),
  }
}

/** A process driven by hand, as `drive` gives it. */
export type Driven = ReturnType<typeof drive>

/**
 * Launches the runtime on the client. It creates the tables of the storage, and holds no database: another runtime
 * may run on the same one. A retry that is no positive integer of milliseconds is the launcher's defect.
 */
export const launch = (options: Options = {}): Effect.Effect<Runtime, never, SqlClient.SqlClient | Scope.Scope> =>
  Effect.gen(function*() {
    const retry = options.retry?.millis ?? 50
    if (!isMillis(retry, 1)) {
      return yield* Effect.die(new InvariantDefect({ reason: `the retry is ${retry} milliseconds, and it is a positive integer` }))
    }
    // Only a sweep left out is the default: a `null` from JavaScript is refused.
    const sweep = options.sweep === undefined ? { millis: 300_000 } : options.sweep
    if (sweep !== 'none' && !(typeof sweep === 'object' && sweep !== null && isMillis(sweep.millis, 1))) {
      const reason = `the sweep is ${JSON.stringify(sweep)}, which is neither 'none' nor a positive integer of millis`
      return yield* Effect.die(new InvariantDefect({ reason }))
    }
    const sql = yield* SqlClient.SqlClient
    yield* createTables
    const p = processOf(sql, yield* Effect.scope, retry, options.probe, undefined)

    const deploy = <T extends Types>(program: Program<T>, options: Readonly<{ outbox?: boolean }> = {}) =>
      Effect.gen(function*() {
        const services = yield* Effect.context<Exclude<T['services'], Entities>>()
        const d = yield* deployed(p, program, options.outbox === true, (operation) =>
          Effect.provideContext(operation, services) as Effect.Effect<void>)
        // An operation a crash interrupted has no fiber in this process, so a transaction of its entity restarts it.
        for (const id of yield* d.storage.interrupted) yield* inEntity(p, d, id, () => Effect.void)
        yield* apart(p, waking(p, d))
        if (sweep !== 'none') yield* apart(p, sweeping(d, sweep.millis))
        const caller = (request: Readonly<{ requestId: string; sender?: unknown }>): Request<T['sender']> => ({
          _tag: 'Caller',
          sender: request.sender === undefined ? null : request.sender,
          id: request.requestId,
        })
        const handle: Handle<T> = {
          create: (id, request) =>
            checked(
              id,
              request.requestId,
              create(p, d, id, (request as { flags?: unknown }).flags ?? null, caller(request)),
              sql,
            ),
          send: (id, message, request) =>
            checked(
              id,
              request.requestId,
              Effect.flatMap(Effect.sync(() => keptFor(request.keep)), (keep) =>
                send(p, d, id, message, caller(request), keep)),
              sql,
            ),
          read: (id) => checked(id, null, d.storage.projected(id)),
          query: (query) => asked(query, d.storage.query(query)),
          reindex: d.storage.reindex,
          expire: expiring(d),
          suspended: d.storage.suspended,
          inspect: (id) =>
            checked(
              id,
              null,
              Effect.map(d.storage.inspect(id), (found) =>
                found === null ? null : inspected(id, found.stored, found.suspension)),
            ),
          resume: (id) => checked(id, null, operate(p, d, id, 'Resume'), sql),
          discard: (id) => checked(id, null, operate(p, d, id, 'Discard'), sql),
        }
        return handle
      })

    const quiet = Effect.gen(function*() {
      if (p.operations.size > 0) return false
      const now = DateTime.toEpochMillis(yield* DateTime.now)
      for (const d of p.deployments.values()) {
        if ((yield* d.storage.due(now)).ready.length > 0) return false
      }
      return true
    })
    // The signal is taken before the look, so whatever ends after the look completes it, and `settled` looks again.
    const settled: Effect.Effect<void> = Effect.suspend(() => {
      const next = p.changed
      return Effect.flatMap(quiet, (is) => is ? Effect.void : Effect.flatMap(Deferred.await(next), () => settled))
    })

    return { deploy, settled }
  })
