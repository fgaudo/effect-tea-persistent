/**
 * The screen's rules, as plain calls of `update`, and then the screen and the hold rehearsed together. The boundary
 * runs in memory between the two programs, with no browser, no server and no database to set up, and the test
 * decides when the screen reads, when its request is sent and when the hold's time runs out.
 */
import { isRejected, subscriptionsOf } from '@fgaudo/effect-tea'
import { applyAll, type Rehearsal as ScreenRehearsal, rehearse as rehearseScreen } from '@fgaudo/effect-tea/testing'
import { expect, test } from 'bun:test'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Fiber from 'effect/Fiber'
import * as HashMap from 'effect/HashMap'
import { HttpServer } from 'effect/http'
import { HttpApiTest } from 'effect/http-api'
import * as Layer from 'effect/Layer'
import * as Opt from 'effect/Option'
import { TestClock } from 'effect/testing'
import type { TypesOf } from '@fgaudo/effect-tea-persistent'
import { type Rehearsal, rehearse } from '@fgaudo/effect-tea-persistent/testing'
import { api } from './api.ts'
import { boundary, Holds } from './boundary.ts'
import { hold } from './hold.ts'
import { Client, type Command, type Message, type Model, screen, type State, update } from './screen.ts'

const flags = { hold: 'seat-12', session: 'screen-1' }
const held: State = { ...flags, sent: 0, seat: { _tag: 'Shown', status: 'Held' } }
const seats: ReadonlyArray<State['seat']> = [
  { _tag: 'Reading' },
  { _tag: 'Missing' },
  { _tag: 'Shown', status: 'Held' },
  { _tag: 'Shown', status: 'Confirmed' },
  { _tag: 'Shown', status: 'Released' },
  { _tag: 'Confirming' },
]

test('a second tap while a confirmation is under way does nothing', () => {
  const { state, commands } = applyAll(update)([{ _tag: 'ConfirmClicked' }], held)
  expect(commands).toEqual([{ _tag: 'Confirm', hold: 'seat-12', requestId: 'screen-1/0' }])
  expect(isRejected(update({ _tag: 'ConfirmClicked' })(state))).toBe(true)
})

test('the model shows Confirm exactly where update accepts it', () => {
  for (const seat of seats) {
    const state = { ...held, seat }
    const accepted = !isRejected(update({ _tag: 'ConfirmClicked' })(state))
    expect(screen.makeModel(state)._tag === 'Held').toBe(accepted)
  }
})

test('the screen reads the hold under its id, but while a confirmation is under way', () => {
  for (const seat of seats) {
    const reads = HashMap.has(subscriptionsOf(screen)({ ...held, seat }), 'seat-12')
    expect(reads).toBe(seat._tag !== 'Confirming')
  }
})

test('the same reading again is the very same state, and a second confirmation bears another request id', () => {
  expect(update({ _tag: 'SeatRead', seat: { status: 'Held' } })(held)).toEqual({ state: held })
  const { commands } = applyAll(update)(
    [{ _tag: 'ConfirmClicked' }, { _tag: 'ConfirmEnded' }, { _tag: 'SeatRead', seat: { status: 'Held' } }, {
      _tag: 'ConfirmClicked',
    }],
    held,
  )
  expect(commands.map((command) => command.requestId)).toEqual(['screen-1/0', 'screen-1/1'])
})

type Shown = ScreenRehearsal<State, Model, Message, Command, never, Client>

/** The screen rehearsed over the boundary in memory, which calls `holds` in place of a handle. */
const shownOver = <A, E>(holds: Holds['Service'], scenario: (shown: Shown) => Effect.Effect<A, E, Client>) =>
  Effect.gen(function*() {
    const client = yield* HttpApiTest.groups(api, ['holds'])
    return yield* rehearseScreen(screen, scenario, { flags }).pipe(Effect.provideService(Client, client))
  }).pipe(
    Effect.provide(Layer.merge(Layer.provide(boundary, Layer.succeed(Holds, holds)), HttpServer.layerServices)),
    Effect.scoped,
  )

const confirm = (model: Model) => model._tag === 'Held' ? Opt.some(model.confirm) : Opt.none()

/**
 * The two calls of a handle, made on a rehearsal of one hold. A rehearsal gives no handle of its program, so the test
 * writes the two calls the boundary makes.
 */
const holdsOf = (id: string, rehearsal: Rehearsal<TypesOf<typeof hold>>) =>
  Holds.of({
    read: (asked) => asked === id ? rehearsal.projection : Effect.succeed(null),
    send: (asked, message, { requestId }) =>
      asked === id ? rehearsal.send(message, { requestId }) : Effect.succeed({ _tag: 'NotFound' }),
  })

/** The hold and its screen, rehearsed together. */
const together = (scenario: (entity: Rehearsal<TypesOf<typeof hold>>, shown: Shown) => Effect.Effect<void, never, Client>) =>
  Effect.runPromise(rehearse(
    hold,
    { at: DateTime.makeUnsafe('2026-11-21T10:00:00Z') },
    (entity) => shownOver(holdsOf('seat-12', entity), (shown) => scenario(entity, shown)),
  ))

test('a seat confirmed on its screen in time is shown confirmed', () =>
  together(Effect.fnUntraced(function*(entity, shown) {
    yield* shown.hearNext('seat-12')
    yield* shown.send(confirm)
    expect((yield* shown.model)._tag).toBe('Confirming')
    yield* shown.runAll
    // The reply says the message applied, and the screen reads what the hold became.
    expect((yield* shown.model)._tag).toBe('Reading')
    expect(yield* entity.state).toEqual({ _tag: 'Confirmed' })
    yield* shown.hearNext('seat-12')
    expect((yield* shown.model)._tag).toBe('Confirmed')
  })))

test('a seat confirmed after its time ran out, on a screen that still shows it held, is shown released', () =>
  together(Effect.fnUntraced(function*(entity, shown) {
    yield* shown.hearNext('seat-12')
    yield* entity.fire('expiry')
    // The screen has not read since, so its button is still there, and the hold rejects what it sends.
    yield* shown.send(confirm)
    yield* shown.runAll
    yield* shown.hearNext('seat-12')
    expect((yield* shown.model)._tag).toBe('Released')
    expect(yield* entity.state).toEqual({ _tag: 'Released' })
  })))

test('a screen opened on no hold shows that it is missing', () =>
  Effect.runPromise(shownOver(
    Holds.of({ read: () => Effect.succeed(null), send: () => Effect.succeed({ _tag: 'NotFound' }) }),
    Effect.fnUntraced(function*(shown) {
      yield* shown.hearNext('seat-12')
      expect((yield* shown.model)._tag).toBe('Missing')
    }),
  )))

/** Holds that answer `Suspended` to the first `suspended` requests, and record the request id of each. */
const suspendedFor = (suspended: number, requests: Array<string>) =>
  Holds.of({
    read: () => Effect.succeed({ status: 'Held' }),
    send: (_, __, { requestId }) =>
      Effect.sync(() => {
        requests.push(requestId)
        return requests.length > suspended ? { _tag: 'Accepted' } : { _tag: 'Suspended' }
      }),
  })

test('a confirmation with no reply yet is sent again under the same request id, until it is answered', () => {
  const requests: Array<string> = []
  return Effect.runPromise(
    shownOver(
      suspendedFor(2, requests),
      Effect.fnUntraced(function*(shown) {
        yield* shown.hearNext('seat-12')
        yield* shown.send(confirm)
        const sending = yield* Effect.forkChild(shown.runAll)
        yield* TestClock.adjust('2 seconds')
        yield* Fiber.join(sending)
        expect(requests).toEqual(['screen-1/0', 'screen-1/0', 'screen-1/0'])
        expect((yield* shown.model)._tag).toBe('Reading')
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  )
})

test('a confirmation never answered is given up within the time the boundary keeps a reply, and the hold is read again', () => {
  const requests: Array<string> = []
  return Effect.runPromise(
    shownOver(
      suspendedFor(Infinity, requests),
      Effect.fnUntraced(function*(shown) {
        yield* shown.hearNext('seat-12')
        yield* shown.send(confirm)
        const sending = yield* Effect.forkChild(shown.runAll)
        yield* TestClock.adjust('30 seconds')
        yield* Fiber.join(sending)
        expect(requests.length).toBe(31)
        expect((yield* shown.model)._tag).toBe('Reading')
      }),
    ).pipe(Effect.provide(TestClock.layer())),
  )
})
