/**
 * The second process of `runtime.processes.test.ts`. It launches a runtime on the file the first process runs on,
 * says it is ready, and sends a desk as many messages as it is told to.
 */
import { SqliteClient } from '@effect/sql-sqlite-bun'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import type { TypesOf } from './index.program.ts'
import { desk, World } from './runtime.test_desk.ts'
import { type Handle, launch } from './runtime.ts'

const [filename = '', count = '0'] = Bun.argv.slice(2)

const world = Layer.succeed(World, World.of({ act: () => Effect.void }))

await Effect.runPromise(
  Effect.scoped(Effect.gen(function*() {
    const desks: Handle<TypesOf<typeof desk>> = yield* Effect.provide(
      Effect.flatMap(launch(), (runtime) => runtime.deploy(desk)),
      world,
    )
    yield* Effect.sync(() => process.stdout.write('ready\n'))
    for (let sent = 0; sent < Number(count); sent++) {
      yield* desks.send('d', { _tag: 'Added' }, { requestId: `second-${sent}`, keep: 'forever' })
      // The other process is given the file between two sends, so that the steps of the two interleave.
      yield* Effect.sleep('1 millis')
    }
  })).pipe(Effect.provide(SqliteClient.layer({ filename }))),
)
