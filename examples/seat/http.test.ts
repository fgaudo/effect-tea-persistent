/**
 * The whole slice over HTTP. The hold runs on the launched runtime, on SQLite. The boundary listens on a port of
 * the machine, and the screen runs as it does in the page, with the client the page uses. The clock is the test's,
 * so the quarter of an hour passes when the test says so.
 */
import { drive } from '@fgaudo/effect-tea/testing'
import { BunHttpServer } from '@effect/platform-bun'
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { expect, test } from 'bun:test'
import * as Effect from 'effect/Effect'
import { FetchHttpClient, HttpClient, HttpRouter, HttpServer } from 'effect/http'
import { HttpApiBuilder, HttpApiClient } from 'effect/http-api'
import * as Layer from 'effect/Layer'
import * as Opt from 'effect/Option'
import { TestClock } from 'effect/testing'
import { type Handle, launch, type Runtime, type TypesOf } from '@fgaudo/effect-tea-persistent'
import { api } from './api.ts'
import { boundary, Holds } from './boundary.ts'
import { hold } from './hold.ts'
import { Client, type Model, screen } from './screen.ts'

/** The boundary served on a free port, with the screen's client of that port and the plain client under it. */
const served = (holds: Holds['Service']) =>
  Layer.merge(
    HttpRouter.serve(
      HttpApiBuilder.layer(api).pipe(Layer.provide(boundary), Layer.provide(Layer.succeed(Holds, holds))),
      { disableLogger: true, disableListenLog: true },
    ),
    Layer.effect(Client, HttpApiClient.make(api)),
  ).pipe(
    Layer.provideMerge(HttpServer.layerTestClient),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(BunHttpServer.layer({ port: 0 })),
  )

/** Runs a scenario on a runtime launched on SQLite in memory, with the holds served over HTTP. */
const overHttp = (
  scenario: (
    holds: Handle<TypesOf<typeof hold>>,
    runtime: Runtime,
  ) => Effect.Effect<void, never, Client | HttpClient.HttpClient>,
) =>
  Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      const runtime = yield* launch()
      const holds = yield* runtime.deploy(hold)
      yield* Effect.provide(scenario(holds, runtime), served(holds))
    })).pipe(Effect.provide([SqliteClient.layer({ filename: ':memory:' }), TestClock.layer()]), Effect.orDie),
  )

const showing = (tag: Model['_tag']) => (model: Model) => model._tag === tag ? Opt.some(model) : Opt.none()

/** The screen's seconds pass: the test's clock moves a second at each turn of the host's timers. */
const seconds = TestClock.adjust('1 second').pipe(
  Effect.andThen(Effect.promise(() => new Promise((resolve) => setTimeout(resolve, 5)))),
  Effect.forever,
)

test('a seat is shown held, is confirmed from its screen, and is shown confirmed', () =>
  overHttp(Effect.fnUntraced(function*(holds) {
    expect(yield* holds.create('seat-12', { requestId: 'hold-1' })).toEqual({ _tag: 'Created' })
    yield* drive(
      screen,
      Effect.fnUntraced(function*(driver) {
        yield* driver.send((model) => model._tag === 'Held' ? Opt.some(model.confirm) : Opt.none())
        yield* driver.waitFor(showing('Confirmed'))
      }),
      { flags: { hold: 'seat-12', session: 'screen-1' } },
    )
    expect(yield* holds.read('seat-12')).toEqual({ status: 'Confirmed' })
  })))

test('a seat nobody confirms is shown released once its timer fires', () =>
  overHttp(Effect.fnUntraced(function*(holds, runtime) {
    yield* holds.create('seat-12', { requestId: 'hold-1' })
    yield* drive(
      screen,
      Effect.fnUntraced(function*(driver) {
        yield* driver.waitFor(showing('Held'))
        yield* TestClock.adjust('15 minutes')
        yield* runtime.settled
        // The screen learns it at its next reading, since nothing tells a screen that a projection changed.
        yield* Effect.raceFirst(driver.waitFor(showing('Released')), seconds)
      }),
      { flags: { hold: 'seat-12', session: 'screen-1' } },
    )
  })))

test('a screen opened on a hold nobody made shows that it is missing', () =>
  overHttp(() =>
    drive(screen, (driver) => Effect.asVoid(driver.waitFor(showing('Missing'))), {
      flags: { hold: 'seat-99', session: 'screen-1' },
    })
  ))

// The runtime refuses such an id as its caller's defect, and the library gives a contract no schema of an id. So the
// boundary takes it, and the server answers 500. Step 12 of the roadmap gives the schema.
test.failing('a request for a hold whose id no database holds is refused as the caller’s', () =>
  overHttp(Effect.fnUntraced(function*() {
    const response = yield* Effect.orDie(HttpClient.get('/holds/%00'))
    expect(response.status).toBe(400)
  })))
