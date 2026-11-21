/**
 * Runs the slice as a process, and holds the seat `seat-12` at its start:
 *
 *     bun examples/seat/serve.ts
 *
 * The runtime is launched on SQLite in memory, so the hold lasts as long as the process. Bun bundles the page's
 * script and serves the page at `/`, and the boundary answers under `/holds`.
 */
import { BunHttpServer, BunRuntime } from '@effect/platform-bun'
import { SqliteClient } from '@effect/sql-sqlite-bun'
import * as Effect from 'effect/Effect'
import { HttpRouter } from 'effect/http'
import { HttpApiBuilder } from 'effect/http-api'
import * as Layer from 'effect/Layer'
import { launch } from '@fgaudo/effect-tea-persistent'
import { api } from './api.ts'
import { boundary, Holds } from './boundary.ts'
import { hold } from './hold.ts'
import page from './index.html'

// The runtime is launched and the holds deployed in the layer's scope, so they stop when the server stops.
const holds = Layer.effect(
  Holds,
  Effect.gen(function*() {
    const runtime = yield* launch()
    const holds = yield* runtime.deploy(hold)
    yield* holds.create('seat-12', { requestId: 'the-first-hold' })
    return holds
  }),
).pipe(Layer.provide(SqliteClient.layer({ filename: ':memory:' })), Layer.orDie)

// The screen reads every second, so the server logs where it listens and no request.
HttpRouter.serve(HttpApiBuilder.layer(api).pipe(Layer.provide(boundary), Layer.provide(holds)), {
  disableLogger: true,
}).pipe(
  Layer.provide(BunHttpServer.layer({ port: 3000, routes: { '/': page } })),
  Layer.launch,
  BunRuntime.runMain,
)
