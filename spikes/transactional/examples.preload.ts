/**
 * Runs the examples' own tests on the spike's runtime: `launch` of the library's main entry is the spike's, and the
 * test files stay as they are. `examples.test.ts` runs `bun test` with this file preloaded.
 *
 * The runtime has no `count`, `sum` or `published`, which step 4 of `docs/roadmap.md` parks or changes. A handle is
 * given them from the storage of today, since the examples' tests read what the steps wrote through them.
 */
import { mock } from 'bun:test'
import * as Effect from 'effect/Effect'
import { SqlClient } from 'effect/sql'
import * as library from '../../src/index.ts'
import type { Program, Types } from '../../src/program.ts'
import { storage } from '../../src/storage.ts'
import { launch } from '../../src/transactional.ts'

const launched = () =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const runtime = yield* launch()
    return {
      ...runtime,
      deploy: <T extends Types>(program: Program<T>) =>
        Effect.map(runtime.deploy(program), (handle) => {
          const { count, sum, published } = storage(program, sql)
          return { ...handle, count, sum, published }
        }),
    }
  })

mock.module('@fgaudo/effect-tea-persistent', () => ({ ...library, launch: launched }))
