/**
 * What a step costs on the runtime, on the states of `large-states.test.ts`: a list of items, with a projection that
 * holds the items or their count. The runtime reads and decodes the state at each step, since it holds no entity in
 * memory. It prints the median time of a step, and checks only that the steps were taken.
 * `SIZES=10,1000,10000,100000` adds the largest state.
 *
 * Seen on 2026-11-21, on Windows with Bun 1.4.5, on a file, the median of 40 steps, in three runs, beside the runtime
 * of an entity loaded in memory that the runtime replaced. As a multiple of that runtime's time, at 10 items it took
 * as long, 2.5 ms. At 1 000 items (48 KB) it took 1.1 to 1.2 times. At 10 000 items (0.5 MB), where the loaded entity
 * took 7 ms with a count and 20 ms with the items, it took 1.0 to 1.5 times. At 100 000 items (5 MB), run once, it
 * took 1.3 to 1.4 times. An entity activated at each step, rather than once a launch, took up to 2.0 times.
 *
 * A profile of 10 000 items with the items in the projection put a step of 31 ms in five parts. The read and the
 * decoding of the state took 3 ms, which a loaded entity does not pay. The activation took 8 ms: 2 ms to encode the
 * state it read, and 6 ms to compute and encode its projection. The step took 9 ms, the write 3 ms and the commit
 * 8 ms. A step computes the projection of the state it read, since it compares the projection before and after.
 */
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { expect, test } from 'bun:test'
import * as Effect from 'effect/Effect'
import * as Schema from 'effect/Schema'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type Json, noWork, program, type TypesOf } from '../src/index.program.ts'
import { type Handle, launch } from '../src/runtime.ts'

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

/** The median time of a step, in milliseconds, of a room of `size` items on a file. */
const measured = (rooms: typeof whole | typeof counted, size: number) => {
  const directory = mkdtempSync(join(tmpdir(), 'effect-tea-persistent-cost-'))
  return Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      const entities: Handle<TypesOf<typeof whole>> = yield* Effect.flatMap(
        launch(),
        (runtime) => runtime.deploy(rooms as typeof whole),
      )
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
    })).pipe(Effect.provide(SqliteClient.layer({ filename: join(directory, 'db.sqlite') }))),
  ).finally(() => rmSync(directory, { recursive: true, force: true }))
}

test('a step as the state grows', async () => {
  const rows: Array<Record<string, string | number>> = []
  for (const size of sizes) {
    for (const [projection, rooms] of [['whole', whole], ['count', counted]] as const) {
      // Each size is measured twice, and the lower median is kept: what else the machine does adds time.
      const time = Math.min(await measured(rooms, size), await measured(rooms, size))
      expect(time).toBeGreaterThan(0)
      rows.push({ projection, items: size, 'ms': Number(time.toFixed(2)) })
    }
  }
  console.table(rows)
}, 600_000)
