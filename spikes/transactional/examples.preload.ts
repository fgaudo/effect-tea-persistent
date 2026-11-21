/**
 * Runs the examples' own tests on the spike's runtime: `launch` of the library's main entry is the spike's, and the
 * test files stay as they are. `examples.test.ts` runs `bun test` with this file preloaded.
 *
 * The spike builds no reading that steps nothing. A handle is given `query`, `count`, `sum`, `published`,
 * `suspended` and `inspect` from the storage of today, since the examples' tests read what the steps wrote through
 * them.
 */
import { mock } from 'bun:test'
import * as Effect from 'effect/Effect'
import { SqlClient } from 'effect/sql'
import * as library from '../../src/index.ts'
import type { Program, Types } from '../../src/program.ts'
import { storage } from '../../src/storage.ts'
import { launch } from './runtime.ts'

const launched = () =>
  Effect.gen(function*() {
    const sql = yield* SqlClient.SqlClient
    const runtime = yield* launch()
    return {
      ...runtime,
      deploy: <T extends Types>(program: Program<T>) =>
        Effect.map(runtime.deploy(program), (handle) => {
          const { query, count, sum, published, suspended, inspect } = storage(program, sql)
          return {
            ...handle,
            query,
            count,
            sum,
            published,
            suspended,
            // The entity as `Handle.inspect` of the library gives it, from what the storage reads.
            inspect: (id: string) =>
              Effect.map(inspect(id), (found) =>
                found === null ? null : {
                  id,
                  state: found.stored.state,
                  mailbox: found.stored.mailbox.map((envelope) =>
                    envelope._tag === 'Inbound'
                      ? { _tag: 'Inbound', request: envelope.request, message: envelope.message }
                      : envelope
                  ),
                  work: Object.values(found.stored.keys)
                    .map(({ key, incarnation, work }) => ({ key, incarnation, work }))
                    .sort((one, other) => one.incarnation - other.incarnation),
                  suspension: found.suspension,
                }),
          }
        }),
    }
  })

mock.module('@fgaudo/effect-tea-persistent', () => ({ ...library, launch: launched }))
