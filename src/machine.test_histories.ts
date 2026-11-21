/**
 * Histories of one entity, and the promises each history keeps. A history is data, played on a `Target`: the
 * machine, and each store of the runtime once the runtime runs on the transaction. The checks read what a caller
 * and a runner see, and no output of the machine, so one property holds every target to the same promises.
 */
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import fc from 'fast-check'
import { defect, noWork, operation, type Program, rejectWith, timer } from './program.ts'

/** `b` runs at most once, `d` is droppable, and `t` is a timer, or an at-most-once operation in an odd version. */
export const keys = ['b', 'd', 't'] as const
export type Key = (typeof keys)[number]

/**
 * A run of the work under a key: what its runner is given, and what its answer carries back. The state draws a new
 * `gen` for a key each time its work starts again, and `shift` is the version that computed a droppable run. So two
 * runs of an entity are never equal, and an answer names the run it belongs to.
 */
export type Operation = Readonly<{ _tag: 'B' | 'D' | 'T'; key: Key; gen: number; shift: number }>
export type Run = Operation | Readonly<{ _tag: 'Timer'; key: Key; gen: number; shift: number }>

/** Every caller's message carries a nonce no other send carries, so the state tells which one it applied. */
export type Inbound =
  | Readonly<{ _tag: 'Start' | 'Stop'; key: Key; nonce: string }>
  | Readonly<{ _tag: 'Refuse' | 'Break'; nonce: string }>

export type Internal =
  | Readonly<{ _tag: 'Done'; run: Run; then: 'End' | 'Again' }>
  | Readonly<{ _tag: 'Unknown'; run: Run }>
  | Readonly<{ _tag: 'Rang'; run: Run }>

/** An internal message `update` was given, with the run the state held under its key then, or null for none. */
export type Seen = Readonly<{ tag: Internal['_tag']; run: Run; current: Run | null }>

export type State = Readonly<{
  want: ReadonlyArray<Key>
  gen: Readonly<Record<Key, number>>
  /** When the timer under `t` is due, in milliseconds. */
  due: number
  applied: ReadonlyArray<string>
  seen: ReadonlyArray<Seen>
}>

export type T = {
  state: State
  flags: null
  inbound: Inbound
  internal: Internal
  operation: Operation
  key: Key
  parameter: {}
  rejection: 'Refused'
  sender: null
  projection: State
  index: never
  services: never
}

/**
 * A version of the toy. A mended one applies `Break`, where the first one dies on it. `shift` grows by one with each
 * deploy, and changes the droppable run under `d`, so a run never comes back. In an odd shift `t` is an at-most-once
 * operation, so a deploy into one starts new work at the activation, and a deploy out of one drops an operation
 * under way.
 */
export type Version = Readonly<{ mended: boolean; shift: number }>

export const first: Version = { mended: false, shift: 0 }

/** A timer under `t` is due this long after the message that armed it is handled. */
const period = 10

const Key = Schema.Literals(keys)
const RunSchema = Schema.Struct({
  _tag: Schema.Literals(['B', 'D', 'T', 'Timer']),
  key: Key,
  gen: Schema.Int,
  shift: Schema.Int,
})
const OperationSchema = Schema.Struct({
  _tag: Schema.Literals(['B', 'D', 'T']),
  key: Key,
  gen: Schema.Int,
  shift: Schema.Int,
})
const StateSchema = Schema.Struct({
  want: Schema.Array(Key),
  gen: Schema.Struct({ b: Schema.Int, d: Schema.Int, t: Schema.Int }),
  due: Schema.Int,
  applied: Schema.Array(Schema.String),
  seen: Schema.Array(Schema.Struct({
    tag: Schema.Literals(['Done', 'Unknown', 'Rang']),
    run: RunSchema,
    current: Schema.NullOr(RunSchema),
  })),
})

const schemas: Program<T>['schemas'] = {
  state: StateSchema,
  flags: Schema.Null,
  inbound: Schema.Union([
    Schema.TaggedStruct('Start', { key: Key, nonce: Schema.String }),
    Schema.TaggedStruct('Stop', { key: Key, nonce: Schema.String }),
    Schema.TaggedStruct('Refuse', { nonce: Schema.String }),
    Schema.TaggedStruct('Break', { nonce: Schema.String }),
  ]),
  internal: Schema.Union([
    Schema.TaggedStruct('Done', { run: RunSchema, then: Schema.Literals(['End', 'Again']) }),
    Schema.TaggedStruct('Unknown', { run: RunSchema }),
    Schema.TaggedStruct('Rang', { run: RunSchema }),
  ]),
  operation: OperationSchema,
  rejection: Schema.Literal('Refused'),
  sender: Schema.Null,
  projection: StateSchema,
}

/** The run `version` holds under `key` in `state`. */
const runOf = (version: Version, state: State, key: Key): Run => {
  const gen = state.gen[key]
  if (key === 'b') return { _tag: 'B', key, gen, shift: 0 }
  if (key === 'd') return { _tag: 'D', key, gen, shift: version.shift }
  return { _tag: version.shift % 2 === 1 ? 'T' : 'Timer', key, gen, shift: 0 }
}

export const sameRun = (a: Run, b: Run) => a._tag === b._tag && a.key === b.key && a.gen === b.gen && a.shift === b.shift

/** Whether the runner of `run` acts at most once. */
export const atMostOnce = (run: Run) => run._tag === 'B' || run._tag === 'T'

const bump = (gen: State['gen'], key: Key): State['gen'] => ({ ...gen, [key]: gen[key] + 1 })

/**
 * What runs an operation of the toy. The machine answers the operations of a history itself, so its runner is never
 * run. A runtime's runner waits for the answer the history gives.
 */
export type Runner = (run: Operation) => Effect.Effect<Internal>

const answered: Runner = () => Effect.die('a target answers the operations of a history')
const unknown = (run: Operation): Internal => ({ _tag: 'Unknown', run })

export const toy = (version: Version, runner: Runner = answered): Program<T> => ({
  name: 'Histories',
  keys: { b: null, d: null, t: null },
  schemas,
  init: () => ({ want: ['b'], gen: { b: 1, d: 0, t: 0 }, due: 0, applied: [], seen: [] }),
  update: (message, { at }) => (state) => {
    switch (message._tag) {
      case 'Start': {
        const applied = [...state.applied, message.nonce]
        if (state.want.includes(message.key)) return { ...state, applied }
        return {
          ...state,
          applied,
          want: keys.filter((key) => key === message.key || state.want.includes(key)),
          gen: bump(state.gen, message.key),
          due: message.key === 't' ? DateTime.toEpochMillis(at) + period : state.due,
        }
      }
      // Stopping an operation that is not droppable is the program's bug, which the machine finds.
      case 'Stop':
        return {
          ...state,
          applied: [...state.applied, message.nonce],
          want: state.want.filter((key) => key !== message.key),
        }
      case 'Refuse':
        return rejectWith('Refused')
      case 'Break':
        return version.mended ? { ...state, applied: [...state.applied, message.nonce] } : defect('broken')
      default: {
        const { key } = message.run
        const current = state.want.includes(key) ? runOf(version, state, key) : null
        const seen = [...state.seen, { tag: message._tag, run: message.run, current }]
        if (current === null) return { ...state, seen }
        const gen = bump(state.gen, key)
        if (message._tag === 'Rang') return { ...state, seen, gen, due: DateTime.toEpochMillis(at) + period }
        if (message._tag === 'Done' && message.then === 'Again') return { ...state, seen, gen }
        return { ...state, seen, gen, want: state.want.filter((held) => held !== key) }
      }
    }
  },
  work: (state) =>
    state.want.length === 0 ? noWork : Object.fromEntries(state.want.map((key) => {
      const run = runOf(version, state, key)
      return [
        key,
        run._tag === 'Timer' ? timer<Internal>(DateTime.makeUnsafe(state.due), { _tag: 'Rang', run }) : run,
      ]
    })),
  operations: {
    B: operation.atMostOnce(runner, unknown),
    D: operation.droppable(runner),
    T: operation.atMostOnce(runner, unknown),
  },
  project: (state) => state,
  indexes: {},
})

/** A deploy a history asks for, of the next shift, mended or not, or null for none. */
type Deploy = Readonly<{ mended: boolean }> | null

export type Act =
  | Readonly<{ _tag: 'Send'; message: Readonly<{ _tag: 'Start' | 'Stop'; key: Key }> | Readonly<{ _tag: 'Refuse' | 'Break' }> }>
  /** Sends again an earlier send's message, under its request id. */
  | Readonly<{ _tag: 'Retry'; pick: number }>
  | Readonly<{ _tag: 'Complete'; pick: number; then: 'End' | 'Again' }>
  | Readonly<{ _tag: 'Die'; pick: number }>
  /** Answers a run the target started, which may have ended or been replaced since. */
  | Readonly<{ _tag: 'Late'; pick: number }>
  | Readonly<{ _tag: 'Advance'; millis: number }>
  | Readonly<{ _tag: 'Restart'; deploy: Deploy }>
  | Readonly<{ _tag: 'Resume'; deploy: Deploy }>
  | Readonly<{ _tag: 'Discard'; deploy: Deploy }>

const key = fc.constantFrom(...keys)
const pick = fc.nat()
const deploy: fc.Arbitrary<Deploy> = fc.option(fc.record({ mended: fc.boolean() }), { nil: null })

export const act: fc.Arbitrary<Act> = fc.oneof(
  {
    weight: 6,
    arbitrary: fc.record({
      _tag: fc.constant('Send' as const),
      message: fc.oneof(
        { weight: 3, arbitrary: fc.record({ _tag: fc.constant('Start' as const), key }) },
        { weight: 1, arbitrary: fc.record({ _tag: fc.constant('Stop' as const), key }) },
        { weight: 1, arbitrary: fc.record({ _tag: fc.constant('Refuse' as const) }) },
        { weight: 2, arbitrary: fc.record({ _tag: fc.constant('Break' as const) }) },
      ),
    }),
  },
  { weight: 2, arbitrary: fc.record({ _tag: fc.constant('Retry' as const), pick }) },
  {
    weight: 3,
    arbitrary: fc.record({
      _tag: fc.constant('Complete' as const),
      pick,
      then: fc.constantFrom('End' as const, 'End' as const, 'Again' as const),
    }),
  },
  { weight: 1, arbitrary: fc.record({ _tag: fc.constant('Die' as const), pick }) },
  { weight: 1, arbitrary: fc.record({ _tag: fc.constant('Late' as const), pick }) },
  { weight: 2, arbitrary: fc.record({ _tag: fc.constant('Advance' as const), millis: fc.integer({ min: 0, max: 25 }) }) },
  { weight: 2, arbitrary: fc.record({ _tag: fc.constant('Restart' as const), deploy }) },
  { weight: 2, arbitrary: fc.record({ _tag: fc.constant('Resume' as const), deploy }) },
  { weight: 2, arbitrary: fc.record({ _tag: fc.constant('Discard' as const), deploy }) },
)

export const history = fc.array(act, { maxLength: 40 })

/** What a caller is answered: a reply, or no reply yet while the entity is suspended. */
export type Answer =
  | Readonly<{ _tag: 'Accepted' }>
  | Readonly<{ _tag: 'Rejected'; reason: unknown }>
  | Readonly<{ _tag: 'Suspended' }>
  | Readonly<{ _tag: 'Reused' }>

/**
 * An entity of the toy a history is played on, created by the first version. A deploy is given the version whole,
 * and null keeps the version deployed.
 */
export interface Target {
  /** Sends a caller's message under `requestId`, and gives its answer. */
  readonly send: (requestId: string, message: Inbound) => Effect.Effect<Answer>
  /** The runs of operations under way, which a history completes or kills. */
  readonly running: Effect.Effect<ReadonlyArray<Operation>>
  /** Every run of an operation the target started, in order, and a run started again once more. */
  readonly started: Effect.Effect<ReadonlyArray<Operation>>
  /** Ends `run` with its answer. A run no longer under way is a late answer. */
  readonly complete: (run: Operation, then: 'End' | 'Again') => Effect.Effect<void>
  /** `run` dies with a defect. */
  readonly die: (run: Operation) => Effect.Effect<void>
  /** Time passes by `millis`, and each timer due fires at its time. */
  readonly advance: (millis: number) => Effect.Effect<void>
  /** The process dies, and the entity is activated again, by `version` when one is given. */
  readonly restart: (version: Version | null) => Effect.Effect<void>
  /** An operator resumes the entity, after a deploy of `version` when one is given. */
  readonly resume: (version: Version | null) => Effect.Effect<void>
  /** An operator discards the message the entity died on, after a deploy of `version` when one is given. */
  readonly discard: (version: Version | null) => Effect.Effect<void>
  /** The projection, which is the state whole. */
  readonly read: Effect.Effect<State>
  /** Whether the entity is suspended, as an operator reads it. */
  readonly suspended: Effect.Effect<boolean>
}

/**
 * What a history showed: each send with its answer, the runs started, and at the end the state, the runs under way,
 * whether the entity is suspended, and the version deployed last.
 */
export type Played = Readonly<{
  sent: ReadonlyArray<Readonly<{ requestId: string; nonce: string; answer: Answer }>>
  started: ReadonlyArray<Operation>
  state: State
  running: ReadonlyArray<Operation>
  suspended: boolean
  version: Version
}>

export const play = (acts: ReadonlyArray<Act>, target: Target): Effect.Effect<Played> =>
  Effect.gen(function*() {
    const sent: Array<Readonly<{ requestId: string; message: Inbound; answer: Answer }>> = []
    let requests = 0
    let version = first
    const deployed = (deploy: Deploy): Version | null => {
      if (deploy === null) return null
      version = { mended: deploy.mended, shift: version.shift + 1 }
      return version
    }
    const chosen = <A>(runs: ReadonlyArray<A>, at: number) => runs.length === 0 ? undefined : runs[at % runs.length]
    for (const act of acts) {
      switch (act._tag) {
        case 'Send': {
          const at = requests++
          const message = { ...act.message, nonce: `n${at}` } as Inbound
          const requestId = `r${at}`
          sent.push({ requestId, message, answer: yield* target.send(requestId, message) })
          break
        }
        case 'Retry': {
          const earlier = chosen(sent, act.pick)
          if (earlier === undefined) break
          sent.push({ ...earlier, answer: yield* target.send(earlier.requestId, earlier.message) })
          break
        }
        case 'Complete': {
          const run = chosen(yield* target.running, act.pick)
          if (run !== undefined) yield* target.complete(run, act.then)
          break
        }
        case 'Die': {
          const run = chosen(yield* target.running, act.pick)
          if (run !== undefined) yield* target.die(run)
          break
        }
        case 'Late': {
          const run = chosen(yield* target.started, act.pick)
          if (run !== undefined) yield* target.complete(run, 'End')
          break
        }
        case 'Advance':
          yield* target.advance(act.millis)
          break
        case 'Restart':
          yield* target.restart(deployed(act.deploy))
          break
        case 'Resume':
          yield* target.resume(deployed(act.deploy))
          break
        case 'Discard':
          yield* target.discard(deployed(act.deploy))
          break
      }
    }
    return {
      sent: sent.map(({ requestId, message, answer }) => ({ requestId, nonce: message.nonce, answer })),
      started: yield* target.started,
      state: yield* target.read,
      running: yield* target.running,
      suspended: yield* target.suspended,
      version,
    }
  })

/** The promises a played history broke, each as a sentence, or none. */
export const violations = ({ sent, started, state, running, suspended, version }: Played): ReadonlyArray<string> => {
  const broken: Array<string> = []

  // A message under a request id is applied at most once, a message accepted is applied, and a retry is given the
  // reply the first answer gave. `Suspended` is no reply yet.
  const replied = new Map<string, Answer>()
  for (const { requestId, nonce, answer } of sent) {
    if (answer._tag === 'Suspended') continue
    const first = replied.get(requestId)
    if (first === undefined) replied.set(requestId, answer)
    else if (JSON.stringify(first) !== JSON.stringify(answer)) {
      broken.push(`${requestId} was answered ${JSON.stringify(first)}, then ${JSON.stringify(answer)}`)
    }
    if (answer._tag === 'Accepted' && !state.applied.includes(nonce)) {
      broken.push(`${requestId} was accepted, and its message ${nonce} was never applied`)
    }
  }
  const applied = new Set<string>()
  for (const nonce of state.applied) {
    if (applied.has(nonce)) broken.push(`the message ${nonce} was applied twice`)
    applied.add(nonce)
  }

  // An at-most-once run is started at most once, and is given `unknown` only where it started.
  for (const [at, run] of started.entries()) {
    if (atMostOnce(run) && started.slice(0, at).some((earlier) => sameRun(earlier, run))) {
      broken.push(`the at-most-once run ${JSON.stringify(run)} was started twice`)
    }
  }
  for (const { tag, run } of state.seen) {
    if (tag === 'Unknown' && !started.some((earlier) => sameRun(earlier, run))) {
      broken.push(`the run ${JSON.stringify(run)} was given unknown, and never started`)
    }
  }

  // No answer of an earlier run is delivered: `update` is given an answer only of the run its key holds.
  for (const { tag, run, current } of state.seen) {
    if (current === null || !sameRun(run, current)) {
      broken.push(`${tag} of ${JSON.stringify(run)} was delivered while the key held ${JSON.stringify(current)}`)
    }
  }

  // The operations the state holds run while the entity is not suspended: a late answer stops no run under way.
  // A suspended entity's keys may still be those of the version before a deploy, so it is not read.
  // A run the state no longer holds does not run either: a droppable run that a step dropped or changed stops. The
  // machine's target reads a run from its key's work, so only a runtime's target can fail this.
  if (!suspended) {
    for (const key of state.want) {
      const run = runOf(version, state, key)
      if (run._tag !== 'Timer' && !running.some((under) => sameRun(under, run))) {
        broken.push(`the state holds ${JSON.stringify(run)}, which does not run`)
      }
    }
    for (const run of running) {
      if (!state.want.includes(run.key) || !sameRun(run, runOf(version, state, run.key))) {
        broken.push(`${JSON.stringify(run)} runs, and the state does not hold it`)
      }
    }
  }
  return broken
}
