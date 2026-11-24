/**
 * A rehearsal runs the runtime's own step, `drive` of `runtime.ts`, on a database of SQLite in memory of its own. The
 * test holds the clock and answers the operations: the process forks no operation and fires no timer by itself. So a
 * rehearsal stores and reads back what the runtime does, through the migrations, and answers what the runtime
 * answers.
 */
import { SqliteClient } from '@effect/sql-sqlite-node'
import * as Cause from 'effect/Cause'
import * as Clock from 'effect/Clock'
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Duration from 'effect/Duration'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Layer from 'effect/Layer'
import * as Scope from 'effect/Scope'
import * as Semaphore from 'effect/Semaphore'
import { SqlClient } from 'effect/sql'
import * as Machine from './machine.ts'
import {
  type Address,
  checkProgram,
  type Creation,
  Entities,
  encode,
  type Flagged,
  type FlagsOf,
  type IdempotencyKey,
  idFault,
  InvariantDefect,
  isProgram,
  isTimer,
  type Key,
  type Piece,
  type Program,
  type Receiver,
  type Request,
  requestIdFault,
  type Reused,
  runnerOf,
  type SenderOf,
  type Types,
} from './program.ts'
import { type Deployment, type Driven, drive, type Driver, type Operated, Unanswered } from './runtime.ts'
import { createTables, type Suspended } from './storage.ts'

/** The reply `Accepted`, to compare with. */
export const accepted: Readonly<{ _tag: 'Accepted' }> = { _tag: 'Accepted' }

/** Matches any rejection, whatever its reason. */
export const rejected: Readonly<{ _tag: 'Rejected' }> = { _tag: 'Rejected' }

/**
 * The defect of an act that suspended an entity, or of a send to an entity that is suspended: the entity, and the
 * cause of its suspension. The entity stays suspended, as the runtime leaves it, and `resume` and `discard` act on it
 * as an operator does. The cause of an entity suspended before the act is the text an operator reads.
 */
export class EntitySuspended extends Error {
  readonly _tag = 'EntitySuspended'
  constructor(readonly entity: Address, readonly reason: unknown) {
    super(`${entity.name} '${entity.id}' is suspended: ${Machine.render(reason)}`)
  }
}

/**
 * Work under way under a key, in one incarnation. The key is its name, and the parameter as its schema encodes it
 * for a key that takes one.
 */
export interface Pending<Work = unknown> {
  /** The key the work is under. */
  readonly key: Key
  /** The incarnation of the run under way, which its answer carries. */
  readonly incarnation: number
  /**
   * The idempotency key the operation's runner is given: its digest for a runner declared with `operation.digest`.
   * A timer's is the readable one, which nothing is given.
   */
  readonly idempotencyKey: IdempotencyKey
  /** The operation or the timer, as the stored state holds it: a test asserts it by value. */
  readonly work: Work
}

/** The parameter a key takes after its name, or nothing for a key without one. */
type Parameter<T extends Types, K> = K extends keyof T['parameter'] ? [parameter: T['parameter'][K]] : []

/**
 * The request of a rehearsal's message: who sends it, and the request id the test names, if any. A program whose
 * sender is `null` may leave the sender out, and then the request whole, as a caller of the runtime does.
 */
type SentBy<T extends Types> = [T['sender']] extends [null] ? [request?: Readonly<{ requestId?: string }> & SenderOf<T>]
  : [request: Readonly<{ requestId?: string }> & SenderOf<T>]

/** The work under way under a key of `T`, as `pending` gives it. */
type PendingOf<T extends Types> = Pending<Piece<T['operation'], T['internal']>>

/** What a rehearsal does to one entity, whether it runs alone or in a world. */
interface Acts<T extends Types> {
  /** The entity's state, as the runtime reads it back after the last act of the test. */
  readonly state: Effect.Effect<T['state']>
  /** The entity's projection, as a caller reads it after the last act of the test. */
  readonly projection: Effect.Effect<T['projection']>
  /**
   * Delivers an inbound message from a caller, as `Handle.send` does. Given a request id, it is a request the test
   * names, whose reply is kept for the whole rehearsal, as one sent with `keep: 'forever'`: a second send under the
   * same sender and request id is given that reply, and one that carries another message is answered `Reused`.
   * Without a request id, each send is a new request, whose reply no later send finds. A send to the entity while it
   * is suspended fails with `EntitySuspended`, and its message waits in the mailbox for the resumption.
   */
  readonly send: (
    message: T['inbound'],
    ...request: SentBy<T>
  ) => Effect.Effect<Machine.StoredReply<T['rejection']> | Reused>
  /**
   * Delivers an inbound message from another entity's operation, as a new run of it. The entity need not exist: the
   * test answers for it. Under the address of an entity of the world, the run is none of that entity's own.
   */
  readonly sendFrom: (message: T['inbound'], entity: Address) => Effect.Effect<Machine.StoredReply<T['rejection']>>
  /**
   * The work under way under `key`, one of the program's own, with its parameter for a key that takes one. Fails
   * the test when there is none.
   */
  readonly pending: <K extends T['key']>(key: K, ...parameter: Parameter<T, K>) => Effect.Effect<PendingOf<T>>
  /** The work under way under `key`, as `pending` gives it, or null when there is none. */
  readonly underWay: <K extends T['key']>(key: K, ...parameter: Parameter<T, K>) => Effect.Effect<PendingOf<T> | null>
  /**
   * Completes an operation with `message`. It is dropped when the operation's incarnation has moved on. It fails the
   * test when the step that handles it returns the same operation under its key, which would run again at once.
   * Given a key, it completes the work under way under the key, and fails the test when there is none.
   */
  readonly answer: {
    <K extends T['key']>(
      key: K,
      ...rest: [...parameter: Parameter<T, K>, message: T['internal']]
    ): Effect.Effect<'Delivered' | 'Dropped'>
    (pending: Pending, message: T['internal']): Effect.Effect<'Delivered' | 'Dropped'>
  }
  /**
   * Time moves to the timer's time, never back, and the timers of the world due by then fire in the order of their
   * times, this one last. It is `Dropped` when the timer is not under way by its turn. Given a key, it is the timer
   * under way under the key's.
   */
  readonly fire: {
    <K extends T['key']>(key: K, ...parameter: Parameter<T, K>): Effect.Effect<'Delivered' | 'Dropped'>
    (pending: Pending): Effect.Effect<'Delivered' | 'Dropped'>
  }
  /** The entity's suspension, as `Handle.suspended` lists it, or null for an entity that is not suspended. */
  readonly suspension: Effect.Effect<Suspended | null>
  /** An operator resumes the entity, as `Handle.resume` does, and is told what the resumption did. */
  readonly resume: Effect.Effect<Operated>
  /** An operator discards the message the entity died on, as `Handle.discard` does. */
  readonly discard: Effect.Effect<Operated>
}

/** A rehearsal of one entity, as `rehearse` gives it to the scenario: what the test does to the entity, and reads of it. */
export interface Rehearsal<T extends Types> extends Acts<T> {
  /**
   * The process dies after the last commit, and a new one steps the entity from what was stored. At-most-once
   * operations under way deliver their `unknown` message instead of running again.
   */
  readonly restart: Effect.Effect<void>
  /**
   * A deploy: the process dies, and `program`, a new version, steps the entity from what was stored, as the
   * runtime's activation does. A program that changes, drops or delivers otherwise an operation under way suspends
   * the entity, and the deploy fails with `EntitySuspended`. A program that cannot run as written fails before the
   * process dies, and one under another name fails as the activation's defect.
   */
  readonly deploy: (program: Program<T>) => Effect.Effect<void>
  /**
   * Time passes by `duration`. Each timer due within it fires at its time, in the order of the times, and its
   * message is handled before the next one fires. At one time, a key fires again only with a due time later than
   * the one it last fired with, or the test fails. A defect suspends its entity alone, and fails the act once time
   * has passed.
   */
  readonly advance: (duration: Duration.Input) => Effect.Effect<void>
}

/**
 * The services a run of `T` needs from the scenario: those of all its runners but `Entities`, which the world
 * provides. A key may hold any operation of `T`, so no type tells which runner a run reaches.
 */
export type Outside<T extends Types> = Exclude<T['services'], Entities>

/** An entity of a world: what a rehearsal does to one entity, and the runs of its operations. */
export interface Member<T extends Types> extends Acts<T> {
  /**
   * Runs the operation's runner, and completes the operation with its message, as `answer` does. What the runner
   * sends reaches the entities of the world, each in a step of its own. A runner that dies suspends its entity, as
   * in the runtime. A receiver with no reply, since it is suspended, fails the run with no step, and the operation
   * stays under way. It fails the test when the work under `pending` is not an operation running in that
   * incarnation.
   */
  readonly run: {
    (pending: Pending): Effect.Effect<'Delivered' | 'Dropped', never, Outside<T>>
    /**
     * Runs the runner to its end, drops its message, and restarts the world: the process died between the replies
     * the runner was given and the completion. The next run of the operation is given the stored replies.
     */
    (pending: Pending, options: Readonly<{ crash: true }>): Effect.Effect<void, never, Outside<T>>
    /** Runs the operation under way under `key`, and fails the test when there is none. */
    <K extends T['key']>(
      key: K,
      ...parameter: Parameter<T, K>
    ): Effect.Effect<'Delivered' | 'Dropped', never, Outside<T>>
    <K extends T['key']>(
      key: K,
      ...rest: [...parameter: Parameter<T, K>, options: Readonly<{ crash: true }>]
    ): Effect.Effect<void, never, Outside<T>>
  }
}

/** Entities on one process together, with one time for all of them. */
export interface World {
  /**
   * Creates an entity of `program`, which the world runs under its name from then on. It fails the test when the
   * world runs another program under that name, and when the program's `init` rejects the flags: a test of a
   * rejection calls `init` itself, which is pure, or creates from a runner, whose `create` is answered `Rejected`.
   * The flags come last, and are left out where the program's flags are `null`.
   */
  readonly create: <T extends Types>(program: Program<T>, id: string, ...flags: Flagged<T>) => Effect.Effect<Member<T>>
  /** The process dies after the last commit, and a new one steps every entity from what was stored. */
  readonly restart: Effect.Effect<void>
  /**
   * A deploy of a new version of a program: the process dies, and a new one steps every entity, those of the program
   * by the new version. A program that cannot run as written fails the test before the process dies.
   */
  readonly deploy: <T extends Types>(program: Program<T>) => Effect.Effect<void>
  /** Time passes by `duration` for every entity of the world, as `Rehearsal.advance` says. */
  readonly advance: (duration: Duration.Input) => Effect.Effect<void>
}

/** What a library's test watches of a world: each run a committed step started. */
export type Watch = Readonly<{ started?: (entity: Address, pending: Pending) => void }>

/** A program's own deaths, with the reason the runtime gives them. */
const invariant = (reason: string) => Effect.die(new InvariantDefect({ reason }))

const millisOf = DateTime.toEpochMillis

/** A rehearsal starts at a whole millisecond, as `advance` moves by whole milliseconds. */
const startsAt = (at: DateTime.Utc): Effect.Effect<void> =>
  Effect.suspend(() =>
    Number.isInteger(millisOf(at))
      ? Effect.void
      : Effect.die(`a rehearsal starts at a whole millisecond, not ${millisOf(at)}`)
  )

/** Whether `outputs` delivered the work of `pending`. */
const outcome = (pending: Pending) => (outputs: ReadonlyArray<Machine.Output<Types>>) =>
  outputs.some((output) =>
      output._tag === 'Delivered' && Machine.keyText(output.key) === Machine.keyText(pending.key) &&
      output.incarnation === pending.incarnation
    )
    ? 'Delivered' as const
    : 'Dropped' as const

/** The outputs of the event a transaction applies, without those of a restart before it. */
const applied = <T extends Types>(
  tx: Parameters<Parameters<Driven['step']>[2]>[0],
  event: Machine.Event<T>,
) =>
  Effect.suspend(() => {
    const from = tx.outputs.length
    return Effect.map(
      tx.apply(event as Machine.Event<Types>),
      () => tx.outputs.slice(from) as ReadonlyArray<Machine.Output<T>>,
    )
  })

/**
 * The world of a rehearsal on the client `sql`: the programs it runs by name, the process, and the time, which every
 * entity shares. Nothing happens by itself. Each act of the test is one at a time, under a lock, so that a scenario
 * that acts from two fibers steps as the runtime would, one transaction after another.
 */
const makeWorld = (sql: SqlClient.SqlClient, scope: Scope.Scope, at: DateTime.Utc, watch: Watch): World & {
  readonly memberOf: <T extends Types>(address: Address) => Member<T>
} => {
  let now = millisOf(at)
  const nanos = () => BigInt(now) * 1_000_000n
  // The process reads the time through `Clock`, and only its steps are given the test's, so a scenario keeps its own.
  const clock: Clock.Clock = {
    currentTimeMillisUnsafe: () => now,
    currentTimeMillis: Effect.sync(() => now),
    currentTimeNanosUnsafe: nanos,
    currentTimeNanos: Effect.sync(nanos),
    monotonicTimeNanosUnsafe: nanos,
    monotonicTimeNanos: Effect.sync(nanos),
    sleep: () => Effect.die('a step of a rehearsal waits for no time'),
  }
  const timed = <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.provideService(effect, Clock.Clock, clock)

  // The programs by name, in the order the world deployed them, and their deployments in the process that runs.
  const programs = new Map<string, Program<any>>()
  const deployments = new Map<string, Deployment<any>>()
  // The suspensions the steps since the last act committed, which the act fails with.
  const fallen: Array<EntitySuspended> = []
  // The request ids the test named, which a drawn one never is.
  const named = new Set<string>()
  let requests = 0
  // The incarnations of the runs a `sendFrom` stands for, drawn down from 0, which no entity draws.
  let forged = 0

  const deployedAs = <T extends Types>(program: Receiver<T>): Effect.Effect<Deployment<T>> =>
    Effect.suspend(() => {
      const held = deployments.get(program.name)
      if (held !== undefined) return Effect.succeed(held)
      // A reference brings no code. In the runtime a send waits for the deploy, which a test never makes, so the run
      // fails, and no step records it.
      if (!isProgram(program)) {
        return Effect.die(
          new Unanswered(`the world runs no program '${program.name}', and a reference to it brings no code to run`),
        )
      }
      return Effect.tap(process.deploy(program), (d) =>
        Effect.sync(() => {
          programs.set(program.name, program)
          deployments.set(program.name, d)
        }))
    })

  const driver: Driver = {
    started: (entity, { key, incarnation, idempotencyKey, operation }) =>
      watch.started?.(entity, { key, incarnation, idempotencyKey, work: operation }),
    suspended: (entity, cause) => void fallen.push(new EntitySuspended(entity, cause)),
    deploy: deployedAs,
  }
  let process = drive(sql, scope, driver)

  const lock = Semaphore.makeUnsafe(1)
  /**
   * One act of the test, under the lock, with the test's time. A step that suspended an entity fails it, before
   * what the act itself gave.
   */
  const act = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    lock.withPermit(timed(Effect.flatMap(Effect.exit(effect), (exit) => {
      const first = fallen[0]
      fallen.length = 0
      return first === undefined ? exit : Effect.die(first)
    })))

  /** Every id of a program's entities, by id. */
  const idsOf = (d: Deployment<any>) =>
    Effect.gen(function*() {
      const ids: Array<string> = []
      while (true) {
        const page = yield* d.storage.entities(ids.at(-1) ?? '')
        if (page.length === 0) return ids
        ids.push(...page.map(({ id }) => id))
      }
    })

  const machineOf = <T extends Types>(d: Deployment<T>, id: string) =>
    Effect.map(d.storage.load(id), (stored) =>
      stored === null ? null : process.machine({ name: d.program.name, id }, stored))

  const restart: Effect.Effect<void> = Effect.gen(function*() {
    process = drive(sql, scope, driver)
    deployments.clear()
    for (const program of programs.values()) deployments.set(program.name, yield* process.deploy(program))
    // A new process steps each entity at its first transaction, which starts again the runs a crash stopped. The
    // runtime steps only those with an operation or a message, which step 10 of the roadmap decides.
    for (const d of deployments.values()) {
      for (const id of yield* idsOf(d)) yield* process.step(d, id, () => Effect.void)
    }
  })

  /**
   * Fires the timers of the world due by `until`, in the order of their times, and moves the time to `until`. Given
   * `stop`, it ends once that timer fires, at its time, with whether it was delivered. At one time, a key fires again
   * only with a due time later than the one it last fired with, or the test fails: a key armed again at a due time
   * not later would fire for ever.
   */
  const fireBy = (until: number, stop?: Readonly<{ entity: Address; pending: Pending }>) =>
    Effect.gen(function*() {
      let instant = now
      const fired = new Map<string, DateTime.Utc>()
      while (true) {
        // The timer due earliest. Of two due at one time the one read first fires first, an order no test rests on.
        let next: Readonly<{ d: Deployment<any>; id: string; due: Machine.Due }> | undefined
        for (const d of deployments.values()) {
          for (const id of yield* idsOf(d)) {
            const machine = yield* machineOf(d, id)
            const due = machine === null ? undefined : Machine.nextTimer(machine, DateTime.makeUnsafe(until))
            if (due !== undefined && (next === undefined || DateTime.isLessThan(due.at, next.due.at))) {
              next = { d, id, due }
            }
          }
        }
        if (next === undefined) {
          now = Math.max(now, until)
          return 'Dropped' as const
        }
        const { d, id, due } = next
        const firesAt = Math.max(now, millisOf(due.at))
        if (firesAt !== instant) {
          instant = firesAt
          fired.clear()
        }
        const which = JSON.stringify([d.program.name, id, Machine.keyText(due.key)])
        const last = fired.get(which)
        if (last !== undefined && !DateTime.isGreaterThan(due.at, last)) {
          return yield* Effect.die(
            `the timer under '${Machine.shownKey(due.key)}' of ${d.program.name} '${id}' fires again at ` +
              `${DateTime.formatIso(DateTime.makeUnsafe(firesAt))}, due at ${DateTime.formatIso(due.at)}, no later ` +
              `than its last firing's ${DateTime.formatIso(last)}, and time would never pass`,
          )
        }
        fired.set(which, due.at)
        now = firesAt
        const event = { _tag: 'Fire', key: due.key, incarnation: due.incarnation } as const
        const outputs = yield* process.step(d, id, (tx) => applied(tx, event))
        if (
          stop !== undefined && stop.entity.name === d.program.name && stop.entity.id === id &&
          Machine.keyText(stop.pending.key) === Machine.keyText(due.key) && stop.pending.incarnation === due.incarnation
        ) return outcome(stop.pending)(outputs)
      }
    })

  const advance = (duration: Duration.Input): Effect.Effect<void> =>
    Effect.suspend(() => {
      const length = Duration.fromInputUnsafe(duration)
      if (Duration.isNegative(length) || !Duration.isFinite(length)) {
        return Effect.die(`time passes by a finite duration of zero or more, not ${Duration.format(length)}`)
      }
      // The time stays at a whole millisecond, as the runtime's clock reads it, so that a timer a program arms from
      // the time a message is handled at is due at a whole millisecond.
      if (!Number.isInteger(Duration.toMillis(length))) {
        return Effect.die(`time passes by whole milliseconds, not ${Duration.format(length)}`)
      }
      return Effect.asVoid(fireBy(now + Duration.toMillis(length)))
    })

  /**
   * The runner's `Entities` of a run, which step their receivers with the test's time. A run's requests are the
   * run's own, so a run after a restart is given the stored replies.
   */
  const timedEntities = (entities: Entities['Service']): Entities['Service'] =>
    Entities.of({
      // A program the world does not run has no entity, so a message to it finds none, as a deployment with no
      // entity answers it. A reference brings no code, so the world cannot deploy it.
      send: (program, id, message, name) =>
        !deployments.has(program.name) && !isProgram(program)
          ? Effect.succeed({ _tag: 'NotFound' })
          : timed(entities.send(program, id, message, name)),
      create: (program, id, name, ...flags) => timed(entities.create(program, id, name, ...flags)),
    })

  const memberOf = <T extends Types>(address: Address): Member<T> => {
    const { id } = address
    const d = () => deployments.get(address.name) as Deployment<T>
    const program = () => d().program
    const machine = Effect.suspend(() =>
      Effect.flatMap(machineOf(d(), id), (found) =>
        found === null ? Effect.die(`${address.name} '${id}' is not stored`) : Effect.succeed(found))
    )
    const kindOf = (held: Machine.Machine<T>, { key, incarnation }: Pending) => {
      const running = held.running[Machine.keyText(key)]
      return running?.incarnation === incarnation ? running.kind : undefined
    }

    /** The work under way under the key `name`, with its parameter for a key that takes one, or null. */
    const underWay = (name: T['key'], parameter: unknown) =>
      Effect.map(machine, (held): PendingOf<T> | null => {
        const key = Machine.keyOf(program(), name, parameter)
        const running = held.running[Machine.keyText(key)]
        const work = held.stored.keys[Machine.keyText(key)]?.work
        return running === undefined || work === undefined ? null : {
          key,
          incarnation: running.incarnation,
          idempotencyKey: Machine.idempotencyKeyOf(held, key, running.incarnation),
          work,
        }
      })

    const pending = (name: T['key'], parameter: unknown) =>
      Effect.flatMap(underWay(name, parameter), (found) => {
        if (found !== null) return Effect.succeed(found)
        const key = Machine.keyOf(program(), name, parameter)
        return Effect.die(`no work is under way under '${Machine.shownKey(key)}'`)
      })

    /**
     * The pending an act is given, and the arguments after it. A key is followed by its parameter only where the
     * program declares one for it, so the schema tells a parameter from the message or the options after it.
     */
    const given = (args: ReadonlyArray<unknown>): Effect.Effect<readonly [Pending, ReadonlyArray<unknown>]> =>
      // The keys are read when the act runs, so an act built before a deploy reads the program deployed.
      Effect.suspend(() => {
        const [first, ...rest] = args
        if (typeof first !== 'string') return Effect.succeed([first as Pending, rest] as const)
        const keys = program().keys as unknown as Readonly<Record<string, unknown>>
        const takes = Object.hasOwn(keys, first) && (keys[first] ?? null) !== null
        return Effect.map(
          pending(first as T['key'], takes ? rest[0] : undefined),
          (found) => [found, takes ? rest.slice(1) : rest] as const,
        )
      })

    /** Completes the operation of `pending` with `message`, and the process forgets the run. */
    const complete = (pending: Pending, message: T['internal']) =>
      Effect.gen(function*() {
        const { key, incarnation } = pending
        const { before, outputs } = yield* process.step(d(), id, (tx) => {
          const before = tx.machine?.stored.keys[Machine.keyText(key)]?.work
          const event = { _tag: 'Complete', key, incarnation, message } as const
          return Effect.map(applied(tx, event), (outputs) => ({ before, outputs }))
        })
        process.release(address, key, incarnation)
        const delivered = outcome(pending)(outputs)
        // The runtime cannot tell an operation that loops on its completion from a program that wants it, so the
        // rehearsal fails, stricter than the runtime.
        const again = outputs.find((output) =>
          output._tag === 'Started' && Machine.keyText(output.key) === Machine.keyText(key)
        )
        if (
          delivered === 'Delivered' && again?._tag === 'Started' && before !== undefined &&
          Machine.isSame(program(), key, before, again.operation)
        ) {
          return yield* Effect.die(
            `the operation under '${Machine.shownKey(key)}' came back the same on its completion, and runs again at once`,
          )
        }
        return delivered
      })

    const answer = (pending: Pending, message: T['internal']) =>
      Effect.flatMap(machine, (held) =>
        kindOf(held, pending) === 'Timer'
          ? Effect.die(`the work under '${Machine.shownKey(pending.key)}' is a timer: it fires`)
          : complete(pending, message))

    const fire = (pending: Pending) =>
      Effect.flatMap(machine, (held): Effect.Effect<'Delivered' | 'Dropped'> => {
        const kind = kindOf(held, pending)
        if (kind === 'Operation') {
          return Effect.die(`the work under '${Machine.shownKey(pending.key)}' is an operation: it is answered`)
        }
        const work = held.stored.keys[Machine.keyText(pending.key)]?.work
        if (kind === 'Timer' && isTimer(work)) {
          return fireBy(Math.max(now, millisOf(work.at)), { entity: address, pending })
        }
        // A timer no longer under way is dropped, as the machine drops it.
        const event = { _tag: 'Fire', key: pending.key, incarnation: pending.incarnation } as const
        return Effect.map(process.step(d(), id, (tx) => applied(tx, event)), outcome(pending))
      })

    const run = (pending: Pending, options?: Readonly<{ crash: true }>) =>
      Effect.gen(function*() {
        const { key, incarnation } = pending
        const prepared = yield* act(Effect.flatMap(machine, (held) => {
          if (kindOf(held, pending) !== 'Operation') {
            return invariant(`no operation is running under '${Machine.shownKey(key)}' in incarnation ${incarnation}`)
          }
          const operation = held.stored.keys[Machine.keyText(key)]?.work as T['operation']
          // The work was admitted when it was stored, so the program has a runner for it.
          const runner = runnerOf(program(), operation)!
          const idempotencyKey = Machine.idempotencyKeyOf(held, key, incarnation)
          return Effect.succeed({ operation, runner, idempotencyKey })
        }))
        const { operation, runner, idempotencyKey } = prepared
        const running = runner.delivery === 'Idempotent' || runner.delivery === 'IdempotentDigest'
          ? runner.run(operation, idempotencyKey)
          : runner.run(operation)
        const entities = timedEntities(process.entities(address, key, incarnation, runner.delivery === 'Droppable'))
        // The runner runs outside the lock, so its sends step their receivers one transaction at a time.
        const exit = yield* Effect.exit(Effect.provideService(running, Entities, entities))
        return yield* act(Effect.suspend((): Effect.Effect<'Delivered' | 'Dropped' | void> => {
          if (Exit.isSuccess(exit)) return options?.crash === true ? restart : complete(pending, exit.value)
          // A receiver with no reply yet fails the run, which the runtime would send again: no step records it.
          const squashed = Cause.squash(exit.cause)
          if (squashed instanceof Unanswered) return Effect.failCause(exit.cause)
          // The rehearsal interrupts no run, so a run that ends interrupted dies, as in the runtime.
          const cause = Cause.hasInterruptsOnly(exit.cause)
            ? new Error(`the operation under '${Machine.shownKey(key)}' ended interrupted, and neither completed nor died`)
            : squashed
          const event = { _tag: 'Die', key, incarnation, cause } as const
          return Effect.andThen(
            process.step(d(), id, (tx) => applied(tx, event)),
            Effect.sync(() => process.release(address, key, incarnation)),
          )
        }))
      })

    /**
     * An operator's act. The entity was suspended, so a step that leaves it suspended fails no act: `StillSuspended`
     * says so, with the cause.
     */
    const operated = (event: 'Resume' | 'Discard') =>
      Effect.tap(Effect.suspend(() => process.operate(d(), id, event)), () =>
        Effect.sync(() => {
          const others = fallen.filter(({ entity }) => entity.name !== address.name || entity.id !== id)
          fallen.splice(0, fallen.length, ...others)
        }))

    /** Delivers `message` under `request`, and gives its reply. A suspended entity has none, and fails the act. */
    const receive = (message: T['inbound'], request: Request<T['sender']>, keep?: number) =>
      Effect.flatMap(process.send(d(), id, message, request, keep), (answer) => {
        if (answer._tag === 'Accepted' || answer._tag === 'Rejected' || answer._tag === 'Reused') {
          return Effect.succeed<Machine.StoredReply<T['rejection']> | Reused>(answer)
        }
        if (answer._tag === 'NotFound') return Effect.die(`${address.name} '${id}' is not stored`)
        // A step that suspended the entity fails the act with its live cause, and one suspended before with its text.
        return Effect.flatMap(d().storage.inspect(id), (found) =>
          Effect.die(new EntitySuspended(address, found?.suspension?.cause ?? 'suspended')))
      })

    return {
      state: act(Effect.map(machine, (held) => held.stored.state)),
      projection: act(Effect.flatMap(Effect.suspend(() => d().storage.projected(id)), (found) =>
        found === null ? Effect.die(`${address.name} '${id}' is not stored`) : Effect.succeed(found))),
      send: (message, ...[given]: SentBy<T>) =>
        act(Effect.suspend(() => {
          const sender: T['sender'] = given?.sender === undefined ? null : given.sender
          // A sender that does not encode is the caller's defect, so it is checked before an id is drawn.
          encode(program().schemas.sender, sender, 'sender')
          if (given?.requestId !== undefined) {
            const fault = requestIdFault(given.requestId)
            if (fault !== undefined) return invariant(fault)
            named.add(given.requestId)
            return receive(message, { _tag: 'Caller', sender, id: given.requestId })
          }
          // A drawn id is never one the test named, and its reply is kept for no time, so no later send finds it.
          let drawn: string
          do drawn = `request-${++requests}`
          while (named.has(drawn))
          return receive(message, { _tag: 'Caller', sender, id: drawn }, 0)
        })),
      sendFrom: (message, from) =>
        act(Effect.flatMap(
          Effect.suspend(() =>
            receive(message, {
              _tag: 'Operation',
              entity: from,
              key: { name: 'rehearsal' },
              incarnation: --forged,
              name: 'request',
            })
          ),
          (reply) =>
            reply._tag === 'Reused' ? Effect.die("an operation's request was answered Reused") : Effect.succeed(reply),
        )),
      pending: (name, ...parameter) => act(pending(name, parameter[0])),
      underWay: (name, ...parameter) => act(underWay(name, parameter[0])),
      // Each act takes a pending or a key, and the overloads of its type say which arguments follow.
      answer: ((...args: ReadonlyArray<unknown>) =>
        act(Effect.flatMap(given(args), ([found, [message]]) => answer(found, message as T['internal'])))) as Member<
          T
        >['answer'],
      fire: ((...args: ReadonlyArray<unknown>) =>
        act(Effect.flatMap(given(args), ([found]) => fire(found)))) as Member<T>['fire'],
      run: ((...args: ReadonlyArray<unknown>) =>
        Effect.flatMap(act(given(args)), ([found, [options]]) =>
          run(found, options as Readonly<{ crash: true }> | undefined))) as Member<T>['run'],
      suspension: act(Effect.map(Effect.suspend(() => d().storage.inspect(id)), (found) => found?.suspension ?? null)),
      resume: act(operated('Resume')),
      discard: act(operated('Discard')),
    }
  }

  return {
    memberOf,
    create: (program, id, ...[flags]) =>
      act(Effect.gen(function*() {
        // A runner's `create` reaches the program by name, as in the runtime. The test names the program itself, so
        // another one under that name is the test's mistake, and is not run in silence.
        const d = yield* deployedAs(program)
        if (d.program !== program) {
          return yield* Effect.die(`the world runs another program under the name '${program.name}'`)
        }
        const fault = idFault(id)
        if (fault !== undefined) return yield* invariant(fault)
        if ((yield* d.storage.load(id)) !== null) {
          return yield* Effect.die(`${program.name} '${id}' exists in the world already`)
        }
        // No one retries the test's creation, so it is the entity's own request: no sender is needed.
        const created: Creation<unknown> | Reused = yield* process.create(d, id, flags === undefined ? null : flags, {
          _tag: 'Self',
          id: 'creation',
        })
        if (created._tag === 'Rejected') {
          return yield* Effect.die(`the init of ${program.name} rejected the flags of '${id}'`)
        }
        return memberOf({ name: program.name, id })
      })),
    restart: act(restart),
    advance: (duration) => act(advance(duration)),
    deploy: (program) =>
      act(Effect.andThen(
        Effect.sync(() => {
          checkProgram(program)
          programs.set(program.name, program)
        }),
        restart,
      )),
  }
}

/** A database of SQLite in memory for one rehearsal, which ends with it. */
const memory = Layer.orDie(SqliteClient.layer({ filename: ':memory:' }))

/**
 * Runs `body` on a world of its own database in memory. The client is given to the world alone, so that a scenario
 * that reads a `SqlClient` of its own reads its own.
 */
const inWorld = <A, E, R>(
  at: DateTime.Utc,
  watch: Watch,
  body: (world: ReturnType<typeof makeWorld>) => Effect.Effect<A, E, R>,
) =>
  Effect.andThen(
    startsAt(at),
    Effect.acquireUseRelease(
      Scope.make(),
      (scope) =>
        Effect.flatMap(Layer.buildWithScope(memory, scope), (context) => {
          const sql = Context.get(context, SqlClient.SqlClient)
          return Effect.andThen(
            Effect.provideService(createTables, SqlClient.SqlClient, sql),
            Effect.suspend(() => body(makeWorld(sql, scope, at, watch))),
          )
        }),
      (scope, exit) => Scope.close(scope, exit),
    ),
  )

/**
 * Runs a scenario of one entity, with no database to set up and no clock. Nothing happens by itself: the test
 * answers operations, fires timers and restarts the process. Time stands still at `start.at`, and moves to a timer's
 * time when the timer fires later, and by a duration with `advance`.
 */
const rehearseOne = <T extends Types, E>(
  program: Program<T>,
  start: Readonly<{ at: DateTime.Utc }> & FlagsOf<T>,
  scenario: (rehearsal: Rehearsal<T>) => Effect.Effect<void, E>,
): Effect.Effect<void, E> =>
  // A program the runtime would refuse is refused here too, before the scenario runs.
  Effect.andThen(Effect.sync(() => checkProgram(program)), () =>
    inWorld(start.at, {}, (world) => {
      const flags = (start.flags === undefined ? null : start.flags) as T['flags']
      return Effect.flatMap(world.create(program, 'rehearsal', ...[flags] as Flagged<T>), ({ run: _, ...acts }) =>
        scenario({
          ...acts,
          restart: world.restart,
          advance: world.advance,
          deploy: (next) =>
            next.name === program.name
              ? world.deploy(next)
              // A deploy under another name reaches the entity in the runtime as a defect of the activation.
              : invariant(`the program '${next.name}' replaces the entity's program '${program.name}'`),
        }))
    }))

/**
 * Runs a scenario on a world of entities, with one time and one process for all of them. The scenario creates the
 * entities, and runs the operations' runners with `run`, or answers them as `rehearse` does. What a runner sends
 * reaches the receiver's step.
 */
const together = <E, R>(
  at: DateTime.Utc,
  scenario: (world: World) => Effect.Effect<void, E, R>,
): Effect.Effect<void, E, R> => inWorld(at, {}, scenario)

/** `rehearse.together`, with what a library's test watches of the world. It is no part of the library's entries. */
export const watched = <E, R>(
  at: DateTime.Utc,
  watch: Watch,
  scenario: (world: World) => Effect.Effect<void, E, R>,
): Effect.Effect<void, E, R> => inWorld(at, watch, scenario)

/**
 * Runs a scenario of one entity of `program`, created from `start.flags` at `start.at`, on the runtime's own step
 * over a database in memory of its own, with no database to set up and no clock. A program whose flags are `null`
 * may leave `start.flags` out. The scenario is given a `Rehearsal`, and the test answers the entity's operations,
 * fires its timers and restarts the process. `rehearse.together(at, scenario)` runs several entities in one world
 * instead, where a runner's requests reach the other entities.
 */
export const rehearse: typeof rehearseOne & { readonly together: typeof together } = Object.assign(rehearseOne, {
  together,
})
