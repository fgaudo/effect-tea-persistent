import * as DateTime from 'effect/DateTime'
import * as Schema from 'effect/Schema'
import { noWork, program, reject, timer } from '@fgaudo/effect-tea-persistent/program'
import { Confirm, Seat } from './schemas.ts'

// The seat of the quick start: held for a quarter of an hour, confirmed in time, or released when the time runs out.
const State = Schema.Union([
  Schema.TaggedStruct('Held', { until: Schema.DateTimeUtcFromMillis }),
  Schema.TaggedStruct('Confirmed', {}),
  Schema.TaggedStruct('Released', {}),
])

export const hold = program({
  state: State,
  flags: Schema.Null,
  // The two schemas a browser reads are the ones the screen imports.
  inbound: Confirm,
  internal: Schema.TaggedStruct('Expired', {}),
  projection: Seat,
})({
  name: 'Hold',
  keys: ['expiry'],
  init: (_, at) => ({ _tag: 'Held', until: DateTime.add(at, { minutes: 15 }) }),
  update: (message) => (state) =>
    message._tag === 'Expired' ? { _tag: 'Released' } : state._tag === 'Held' ? { _tag: 'Confirmed' } : reject,
  work: (state) => (state._tag === 'Held' ? { expiry: timer(state.until, { _tag: 'Expired' }) } : noWork),
  project: (state) => ({ status: state._tag }),
})
