/// <reference lib="dom" />
/**
 * The page's script: it runs the screen in the browser, on the hold the address names, with a client of the
 * boundary at the page's own origin.
 */
import { type Frame, run } from '@fgaudo/effect-tea'
import * as Effect from 'effect/Effect'
import { FetchHttpClient } from 'effect/http'
import { HttpApiClient } from 'effect/http-api'
import * as Layer from 'effect/Layer'
import * as Stream from 'effect/Stream'
import { api } from './api.ts'
import { Client, type Message, type Model, screen } from './screen.ts'
import { view } from './view.ts'

const flags = {
  hold: new URLSearchParams(location.search).get('hold') ?? 'seat-12',
  // A name no other screen bears, since a hold keeps one space of request ids for all its callers.
  session: crypto.randomUUID(),
}

const client = Layer.effect(Client, HttpApiClient.make(api, { baseUrl: location.origin })).pipe(
  Layer.provide(FetchHttpClient.layer),
)

// The screen draws one line, so each frame replaces it. A reading that changes nothing draws no frame.
const draw = (frames: Stream.Stream<Frame<Model, Message>>) =>
  Stream.runForEach(
    frames,
    ({ model, dispatch }) => Effect.sync(() => document.body.replaceChildren(view(model, dispatch))),
  )

Effect.runFork(
  run(screen, draw, { flags }).pipe(
    Effect.provide(client),
    // A defect ends the run, and the page says so in place of a screen that no longer answers.
    Effect.tapCause((cause) =>
      Effect.sync(() => {
        console.error(cause)
        document.body.replaceChildren('The screen stopped on a defect. Reload the page.')
      })
    ),
  ),
)
