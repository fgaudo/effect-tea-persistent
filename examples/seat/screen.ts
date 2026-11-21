/**
 * The screen of one hold, a program of effect-tea that runs in the browser. It reads the hold's projection while
 * it shows it, and sends `Confirm`. The entity alone decides what a hold is: the screen never works out a
 * projection, and reads it again after every message it sent.
 */
import { defect, type Program, reject, type Subscription, type Update } from '@fgaudo/effect-tea'
import * as Channel from 'effect/Channel'
import * as Context from 'effect/Context'
import * as Effect from 'effect/Effect'
import * as Equal from 'effect/Equal'
import * as HashMap from 'effect/HashMap'
import { HttpClientError } from 'effect/http'
import type { HttpApiClient } from 'effect/http-api'
import * as Opt from 'effect/Option'
import * as Predicate from 'effect/Predicate'
import * as Schedule from 'effect/Schedule'
import type { api } from './api.ts'
import type { Seat } from './schemas.ts'

/** The client of the boundary, derived from its contract: over HTTP in the page, and in memory in a rehearsal. */
export class Client extends Context.Service<Client, HttpApiClient.ForApi<typeof api>>()('examples/seat/Client') {}

/** The hold the screen shows, and a name of the screen no other screen bears, which names its requests. */
export type Flags = Readonly<{ hold: string; session: string }>

export type State = Readonly<{
  hold: string
  session: string
  /** How many messages the screen has sent, which numbers the next request. */
  sent: number
  seat:
    /** Nothing is known of the hold, or what was known is older than the last message sent. */
    | Readonly<{ _tag: 'Reading' }>
    | Readonly<{ _tag: 'Missing' }>
    | Readonly<{ _tag: 'Shown'; status: Seat['status'] }>
    | Readonly<{ _tag: 'Confirming' }>
}>

export type Message =
  | Readonly<{ _tag: 'SeatRead'; seat: Seat | null }>
  | Readonly<{ _tag: 'ConfirmClicked' }>
  /** The confirmation was answered, or the screen stopped asking: either way the hold is read again. */
  | Readonly<{ _tag: 'ConfirmEnded' }>

export type Command = Readonly<{ _tag: 'Confirm'; hold: string; requestId: string }>

export const update: Update<State, Message, Command> = (message) => (state) => {
  switch (message._tag) {
    case 'SeatRead': {
      // Nothing reads while a confirmation is under way, so no reading arrives then.
      if (state.seat._tag === 'Confirming') return defect('a reading arrived while a confirmation was under way')
      const seat: State['seat'] = message.seat === null
        ? { _tag: 'Missing' }
        : { _tag: 'Shown', status: message.seat.status }
      // The same reading again is the very same state, which draws no frame.
      return Equal.equals(state.seat, seat) ? { state } : { state: { ...state, seat } }
    }
    case 'ConfirmClicked':
      return state.seat._tag === 'Shown' && state.seat.status === 'Held'
        ? {
          state: { ...state, sent: state.sent + 1, seat: { _tag: 'Confirming' } },
          // The request id is the screen's and the request's number, so a request sent again bears the same one.
          commands: [{ _tag: 'Confirm', hold: state.hold, requestId: `${state.session}/${state.sent}` }],
        }
        : reject
    case 'ConfirmEnded':
      // The reply says whether the message applied, and never what the hold became: the projection says it.
      return state.seat._tag === 'Confirming'
        ? { state: { ...state, seat: { _tag: 'Reading' } } }
        : defect('a confirmation ended while none was under way')
  }
}

/** How long the screen waits between two readings, and before it sends a request again. */
const pause = '1 second'

/** A request the network lost, or one the server failed for now, which the same request sent again may pass. */
const lost = HttpClientError.isHttpClientError

/** A confirmation with no reply yet: a lost one, or one to a hold that is suspended. */
const unanswered = (error: unknown) => lost(error) || Predicate.isTagged(error, 'Suspended')

const read = (hold: string) =>
  Effect.service(Client).pipe(
    Effect.flatMap((client) => client.holds.read({ params: { id: hold } })),
    Effect.retry({ schedule: Schedule.spaced(pause), while: lost }),
    // A reading the contract does not decode is a deploy that broke the contract, and no state of the screen.
    Effect.orDie,
  )

/**
 * The hold's projection, read at once and then at each pause. The runtime has no reading that waits for a change,
 * so the screen asks again.
 */
const readings = (hold: string): Subscription<Message, Client> =>
  Channel.forever(
    Channel.fromEffect(read(hold)).pipe(
      Channel.map((seat): Message => ({ _tag: 'SeatRead', seat })),
      Channel.concatWith(() => Channel.fromEffectDrain(Effect.sleep(pause))),
    ),
  )

/** How many times a confirmation is sent again: for half a minute, which is less than the boundary's `keep`. */
const tries = 30

const confirm = ({ hold, requestId }: Command) =>
  Effect.service(Client).pipe(
    Effect.flatMap((client) =>
      client.holds.send({ params: { id: hold }, payload: { requestId, message: { _tag: 'Confirm' } } })
    ),
    Effect.flatMap((answer) =>
      // `Suspended` says the request has no reply yet, so the same request is sent again, as a lost one is.
      answer._tag === 'Suspended'
        ? Effect.fail(answer)
        // The screen sends one message under each request id, so no request of the screen is another one's.
        : answer._tag === 'Reused'
        ? Effect.die(new Error(`the request '${requestId}' was answered Reused`))
        : Effect.void
    ),
    Effect.retry({ schedule: Schedule.spaced(pause), times: tries, while: unanswered }),
    // A request that got no reply in time is given up, and the reading that follows shows whether it applied.
    Effect.catchIf(unanswered, () => Effect.void),
    Effect.orDie,
    Effect.as(Opt.some<Message>({ _tag: 'ConfirmEnded' })),
  )

/** What the page draws: a case for each thing the screen tells apart, with the message of its one control. */
export type Model =
  | Readonly<{ _tag: 'Reading' | 'Missing' | 'Confirming' | 'Confirmed' | 'Released' }>
  | Readonly<{ _tag: 'Held'; confirm: Message }>

export const screen: Program<{
  state: State
  model: Model
  message: Message
  command: Command
  services: Client
  flags: Flags
}> = {
  init: ({ hold, session }) => ({ state: { hold, session, sent: 0, seat: { _tag: 'Reading' } } }),
  update,
  runCommand: confirm,
  // The hold's projection is a subscription under the hold's id. It stops while a confirmation is under way, and
  // starts anew once it ended, so a reading begun before the reply never reaches `update` after it.
  subscriptions: (state) =>
    state.seat._tag === 'Confirming' ? HashMap.empty() : HashMap.make([state.hold, readings(state.hold)]),
  makeModel: ({ seat }) =>
    seat._tag !== 'Shown'
      ? { _tag: seat._tag }
      : seat.status === 'Held'
      ? { _tag: 'Held', confirm: { _tag: 'ConfirmClicked' } }
      : { _tag: seat.status },
}
