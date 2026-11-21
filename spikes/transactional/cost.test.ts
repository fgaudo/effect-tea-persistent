/**
 * What a step costs on the runtime of `src/transactional.ts` beside the runtime of today, on the states of
 * `large-states.test.ts`: a list of items, with a projection that holds the items or their count. The new runtime
 * reads and decodes the state at each step, where the runtime of today steps the copy it holds in memory.
 *
 * It prints what it measured, and checks only that both runtimes took the steps. `SIZES=10,1000,10000,100000` adds
 * the largest state.
 *
 * Seen on 2026-11-21, on Windows with Bun 1.4.5, on a file, the median of 40 steps, in three runs, on the spike that
 * became the new runtime. The spike could activate an entity at each step or once a launch, and the runtime kept the
 * second. The first number is the spike that activates an entity at each step, and the second the one that
 * activates it once a launch, each
 * as a multiple of today's time. At 10 items both took as long as today, 2.5 ms. At 1 000 items (48 KB) they took
 * 1.1 to 1.3 times and 1.1 to 1.2 times. At 10 000 items (0.5 MB), where today takes 7 ms with a count and 20 ms
 * with the items, they took 1.4 to 2.0 times and 1.0 to 1.5 times. At 100 000 items (5 MB), run once, they took 1.5
 * to 1.7 times and 1.3 to 1.4 times.
 *
 * A profile of 10 000 items with the items in the projection put a step of 31 ms in five parts. The read and the
 * decoding of the state took 3 ms, which today's runtime does not pay. The activation took 8 ms: 2 ms to encode the
 * state it read, and 6 ms to compute and encode its projection. The step took 9 ms, the write 3 ms and the commit
 * 8 ms, as today. A step that skips the activation still computes the projection of the state it read, since
 * `Machine.writes` compares what each topic selected before and after. Today's runtime holds that in memory from
 * the step before.
 */
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { expect, test } from 'bun:test'
import * as Effect from 'effect/Effect'
import * as Logger from 'effect/Logger'
import * as Schema from 'effect/Schema'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as library from '../../src/index.ts'
import { type Json, noWork, program, type TypesOf } from '../../src/index.program.ts'
import { type Handle, launch } from '../../src/transactional.ts'

const Item = Schema.Struct({ id: Schema.Int, label: Schema.String })
const State = Schema.Struct({ items: Schema.Array(Item) })
type State = typeof State.Type

const room = <P extends Json>(name: string, projection: Schema.Codec<P, Json>, project: (state: State) => P) =>
  program({
    state: State,
    flags: Schema.Struct({ size: Schema.Int }),
    inbound: Schema.TaggedUnion({ Add: { label: Schema.String } }),
    internal: Schema.Never,
    operation: Schema.Never,
    rejection: Schema.Never,
    sender: Schema.Struct({ id: Schema.String }),
    projection,
  })({
    name,
    keys: [],
    init: ({ size }) => ({
      items: Array.from({ length: size }, (_, id) => ({ id, label: `item number ${id} of the room` })),
    }),
    update: (message) => (state) => ({
      items: [...state.items, { id: state.items.length, label: message.label }],
    }),
    work: () => noWork,
    operations: {},
    project,
    indexes: {},
  })

const whole = room('Whole', State, (state) => state)
const counted = room('Counted', Schema.Struct({ count: Schema.Int }), (state) => ({ count: state.items.length }))

const sizes = process.env['SIZES']?.split(',').map(Number) ?? [10, 1_000, 10_000]
const steps = 40
const sender = { id: 'ada' }

/** The median time of a step, in milliseconds, of a room of `size` items on a file, on one of the two runtimes. */
const measured = (kind: 'today' | 'runtime', rooms: typeof whole | typeof counted, size: number) => {
  const directory = mkdtempSync(join(tmpdir(), 'effect-tea-persistent-cost-'))
  return Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      const entities: Handle<TypesOf<typeof whole>> = yield* (kind === 'today'
        ? Effect.flatMap(library.launch(), (runtime) => runtime.deploy(rooms as typeof whole))
        : Effect.flatMap(launch(), (runtime) => runtime.deploy(rooms as typeof whole)))
      yield* entities.create('r', { flags: { size }, requestId: 'create', sender })
      const taken: Array<number> = []
      // The first steps are left out: they compile the schemas and prepare the statements.
      for (let step = -5; step < steps; step++) {
        const started = performance.now()
        yield* entities.send('r', { _tag: 'Add', label: `added ${step}` }, { requestId: `add-${step}`, sender, keep: 'forever' })
        if (step >= 0) taken.push(performance.now() - started)
      }
      taken.sort((one, other) => one - other)
      return taken[Math.floor(taken.length / 2)] ?? Number.NaN
    })).pipe(
      // The runtime of today warns of a large state at each step of the largest.
      Effect.provide([SqliteClient.layer({ filename: join(directory, 'db.sqlite') }), Logger.layer([])]),
    ),
  ).finally(() => rmSync(directory, { recursive: true, force: true }))
}

test('a step of the spike beside a step of today, as the state grows', async () => {
  const rows: Array<Record<string, string | number>> = []
  for (const size of sizes) {
    for (const [projection, rooms] of [['whole', whole], ['count', counted]] as const) {
      // Each runtime is measured twice, by turns, and the lower median is kept: what else the machine does adds time.
      const times = { today: Infinity, runtime: Infinity }
      for (let turn = 0; turn < 2; turn++) {
        for (const kind of ['today', 'runtime'] as const) {
          times[kind] = Math.min(times[kind], await measured(kind, rooms, size))
        }
      }
      for (const time of Object.values(times)) expect(time).toBeGreaterThan(0)
      rows.push({
        projection,
        items: size,
        'today ms': Number(times.today.toFixed(2)),
        'runtime ms': Number(times.runtime.toFixed(2)),
        'times today': Number((times.runtime / times.today).toFixed(2)),
      })
    }
  }
  console.table(rows)
}, 600_000)
