/**
 * The process `crash.test.ts` kills. It creates a desk and does one act of it, and stops where it is told to: at a
 * point of a transaction of the act, or inside the world, once the act's effect is done there. It says so on its
 * output and waits there to be killed, with whatever transaction it is in left open.
 */
import { SqliteClient } from '@effect/sql-sqlite-bun'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { appendFileSync } from 'node:fs'
import { desk, World } from './desk.ts'
import { launch } from '../../src/transactional.ts'

const [filename = '', world = '', act = '', stop = ''] = Bun.argv.slice(2)

const stopped = Effect.andThen(Effect.sync(() => process.stdout.write('stopped\n')), Effect.never)

// The creation's own transaction passes every point: only the act stops.
let armed = false

const acting = Layer.succeed(
  World,
  World.of({
    act: (what) =>
      Effect.andThen(Effect.sync(() => appendFileSync(world, `${what}\n`)), stop === 'World' ? stopped : Effect.void),
  }),
)

await Effect.runPromise(
  Effect.scoped(Effect.gen(function*() {
    const runtime = yield* launch({ probe: (point) => armed && point === stop ? stopped : Effect.void })
    const desks = yield* Effect.provide(runtime.deploy(desk), acting)
    yield* desks.create('d', { requestId: 'create' })
    armed = true
    const request = { requestId: 'act', keep: 'forever' } as const
    if (act === 'add') yield* desks.send('d', { _tag: 'Added' }, request)
    if (act === 'charge') yield* desks.send('d', { _tag: 'ChargeRequested' }, request)
    if (act === 'mail') yield* desks.send('d', { _tag: 'MailRequested' }, request)
    if (act === 'alarm') {
      const at = DateTime.add(yield* DateTime.now, { milliseconds: 20 })
      yield* desks.send('d', { _tag: 'AlarmSet', at }, request)
    }
    // The work the act started stops the process. A process that gets past this line was never stopped.
    yield* Effect.sleep('5 seconds')
  })).pipe(Effect.provide(SqliteClient.layer({ filename }))),
)
process.stdout.write('ended\n')
