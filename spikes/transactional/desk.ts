/**
 * The program the spike's own tests run: a desk that counts, charges, sends a mail and rings an alarm. It holds one
 * piece of each kind of work, so that a test stops a process at each line of the design's crash table. The charge
 * is idempotent, the mail is sent at most once, and the alarm is a timer.
 */
import * as Context from 'effect/Context'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { operation, program, reject, timer } from '../../src/index.program.ts'

const State = Schema.Struct({
  count: Schema.Int,
  charge: Schema.Literals(['Idle', 'Charging', 'Charged']),
  mail: Schema.Literals(['Idle', 'Sending', 'Sent', 'Unsure']),
  alarm: Schema.NullOr(Schema.DateTimeUtcFromMillis),
  rang: Schema.Int,
})

// What callers read holds the alarm's time as its milliseconds, since a projection is JSON.
const Projection = Schema.Struct({ ...State.fields, alarm: Schema.NullOr(Schema.Int) })

const Inbound = Schema.TaggedUnion({
  Added: {},
  ChargeRequested: {},
  MailRequested: {},
  AlarmSet: { at: Schema.DateTimeUtcFromMillis },
})

const Internal = Schema.TaggedUnion({ Charged: {}, Mailed: {}, MailUnsure: {}, Rang: {} })
type Internal = typeof Internal.Type

const Operation = Schema.TaggedUnion({ Charge: {}, Mail: {} })

/** The world the desk acts on: a test records each act, and stops the process inside one. */
export class World extends Context.Service<World, {
  /** Acts on the world, once for each call. */
  readonly act: (what: string) => Effect.Effect<void>
}>()('spikes/transactional/World') {}

const acting = (what: string, message: Internal) =>
  Effect.gen(function*() {
    const world = yield* World
    yield* world.act(what)
    return message
  })

export const desk = program({
  state: State,
  flags: Schema.Null,
  inbound: Inbound,
  internal: Internal,
  operation: Operation,
  projection: Projection,
})({
  name: 'Desk',
  keys: ['charge', 'mail', 'alarm'],
  init: () => ({ count: 0, charge: 'Idle', mail: 'Idle', alarm: null, rang: 0 }),
  update: (message) => (state) => {
    switch (message._tag) {
      case 'Added':
        return { ...state, count: state.count + 1 }
      case 'ChargeRequested':
        return state.charge === 'Idle' ? { ...state, charge: 'Charging' } : reject
      case 'MailRequested':
        return state.mail === 'Idle' ? { ...state, mail: 'Sending' } : reject
      case 'AlarmSet':
        return { ...state, alarm: message.at }
      case 'Charged':
        return { ...state, charge: 'Charged' }
      case 'Mailed':
        return { ...state, mail: 'Sent' }
      case 'MailUnsure':
        return { ...state, mail: 'Unsure' }
      case 'Rang':
        return { ...state, alarm: null, rang: state.rang + 1 }
    }
  },
  work: (state) => ({
    ...(state.charge === 'Charging' ? { charge: Operation.cases.Charge.make({}) } : {}),
    ...(state.mail === 'Sending' ? { mail: Operation.cases.Mail.make({}) } : {}),
    ...(state.alarm === null ? {} : { alarm: timer(state.alarm, { _tag: 'Rang' }) }),
  }),
  operations: {
    // The world is told the idempotency key, so that a test sees a second run act under the same one.
    Charge: operation((_, key) => acting(`charge ${key}`, { _tag: 'Charged' })),
    Mail: operation.atMostOnce(() => acting('mail', { _tag: 'Mailed' }), (): Internal => ({ _tag: 'MailUnsure' })),
  },
  project: (state) => ({ ...state, alarm: state.alarm === null ? null : DateTime.toEpochMillis(state.alarm) }),
})
