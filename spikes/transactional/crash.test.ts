/**
 * A process killed at each line of the table What survives a crash of `docs/design.md`, on the spike's runtime on a
 * file of SQLite. `crash.child.ts` is the process: it stops at a point of a transaction or inside the world, and
 * this test kills it there, as `sqlite-transaction.test.ts` kills its own. A new runtime on the same file then ends
 * where the machine ends from what the killed process stored.
 *
 * The spike handles a message in the transaction that records it. So the table's last two lines have no state at
 * rest: a process killed after a completion or a firing is recorded, and before the message is handled, stored
 * neither. The operation is then the fourth line's, and the timer fires again from the state.
 */
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { expect, test } from 'bun:test'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TypesOf } from '../../src/index.program.ts'
import { desk, World } from './desk.ts'
import { type Handle, launch, type Runtime } from '../../src/transactional.ts'

type Files = Readonly<{ database: string; world: string }>

const inDirectory = async (body: (files: Files) => Promise<void>) => {
  const directory = mkdtempSync(join(tmpdir(), 'effect-tea-persistent-transactional-'))
  try {
    await body({ database: join(directory, 'store.db'), world: join(directory, 'world.txt') })
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

/** Runs the process that does `act`, and waits until it stops at `stop`. It gives how to kill the process there. */
const stoppedAt = async ({ database, world }: Files, act: string, stop: string) => {
  const child = Bun.spawn(['bun', join(import.meta.dir, 'crash.child.ts'), database, world, act, stop], {
    stdout: 'pipe',
    stderr: 'inherit',
  })
  const reader = child.stdout.getReader()
  let output = ''
  while (!output.includes('stopped')) {
    const { value, done } = await reader.read()
    if (done) break
    output += new TextDecoder().decode(value)
  }
  expect(output).toContain('stopped')
  // No finalizer runs: the process dies as on a crash, with its transaction open on the file.
  return async () => {
    child.kill('SIGKILL')
    await child.exited
  }
}

/** Runs the process that does `act`, waits until it stops at `stop`, and kills it there. */
const killedAt = async (files: Files, act: string, stop: string) => (await stoppedAt(files, act, stop))()

/** What the world saw: each act, in order. */
const acts = ({ world }: Files) => existsSync(world) ? readFileSync(world, 'utf8').split('\n').filter(Boolean) : []

/** A new process on the same file: a runtime, and the desks deployed on the same world. */
const restarted = <A>(
  { database, world }: Files,
  body: (desks: Handle<TypesOf<typeof desk>>, runtime: Runtime) => Effect.Effect<A>,
) =>
  Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      const acting = Layer.succeed(
        World,
        World.of({ act: (what) => Effect.sync(() => appendFileSync(world, `${what}\n`)) }),
      )
      const runtime = yield* launch()
      const desks = yield* Effect.provide(runtime.deploy(desk), acting)
      return yield* body(desks, runtime)
    })).pipe(Effect.provide(SqliteClient.layer({ filename: database }))),
  )

const retry = { requestId: 'act', keep: 'forever' } as const

/** The desk once the new process has nothing left to do. */
const settled = (files: Files) =>
  restarted(files, (desks, runtime) => Effect.andThen(runtime.settled, desks.read('d')))

test('before a step’s transaction commits: nothing of the step is stored, and the retry is handled', () =>
  inDirectory(async (files) => {
    await killedAt(files, 'add', 'BeforeCommit')
    await restarted(files, (desks) =>
      Effect.gen(function*() {
        expect(yield* desks.read('d')).toMatchObject({ count: 0 })
        expect(yield* desks.send('d', { _tag: 'Added' }, retry)).toEqual({ _tag: 'Accepted' })
        expect(yield* desks.read('d')).toMatchObject({ count: 1 })
      }))
  }), 30_000)

test('after the commit, before the reply reaches the caller: the retry is given the stored reply', () =>
  inDirectory(async (files) => {
    await killedAt(files, 'add', 'AfterCommit')
    await restarted(files, (desks) =>
      Effect.gen(function*() {
        expect(yield* desks.read('d')).toMatchObject({ count: 1 })
        expect(yield* desks.send('d', { _tag: 'Added' }, retry)).toEqual({ _tag: 'Accepted' })
        expect(yield* desks.read('d')).toMatchObject({ count: 1 })
      }))
  }), 30_000)

test('after the commit, before the work it started: the work starts, or is not known if at most once', () =>
  inDirectory(async (files) => {
    await killedAt(files, 'charge', 'AfterCommit')
    expect(acts(files)).toEqual([])
    expect(await settled(files)).toMatchObject({ charge: 'Charged' })
    expect(acts(files)).toEqual(['charge ["Desk","d","charge",1]'])
  }).then(() =>
    inDirectory(async (files) => {
      // The step that holds the mail committed, so the machine cannot tell that the mail never started.
      await killedAt(files, 'mail', 'AfterCommit')
      expect(await settled(files)).toMatchObject({ mail: 'Unsure' })
      expect(acts(files)).toEqual([])
    })
  ), 30_000)

test('while an operation runs, its effect done and not recorded: it runs again under its key, or is not known', () =>
  inDirectory(async (files) => {
    await killedAt(files, 'charge', 'World')
    expect(await settled(files)).toMatchObject({ charge: 'Charged' })
    const key = 'charge ["Desk","d","charge",1]'
    expect(acts(files)).toEqual([key, key])
  }).then(() =>
    inDirectory(async (files) => {
      await killedAt(files, 'mail', 'World')
      expect(await settled(files)).toMatchObject({ mail: 'Unsure' })
      expect(acts(files)).toEqual(['mail'])
    })
  ), 30_000)

test('after a completion is recorded, before it is handled: neither is stored, as while the operation runs', () =>
  inDirectory(async (files) => {
    await killedAt(files, 'charge', 'Recorded')
    expect(await settled(files)).toMatchObject({ charge: 'Charged' })
    const key = 'charge ["Desk","d","charge",1]'
    expect(acts(files)).toEqual([key, key])
  }).then(() =>
    inDirectory(async (files) => {
      await killedAt(files, 'mail', 'Recorded')
      expect(await settled(files)).toMatchObject({ mail: 'Unsure' })
      expect(acts(files)).toEqual(['mail'])
    })
  ), 30_000)

test('after a timer fired, before its message is handled: the timer fires again from the state', () =>
  inDirectory(async (files) => {
    await killedAt(files, 'alarm', 'Recorded')
    expect(await settled(files)).toMatchObject({ alarm: null, rang: 1 })
  }), 30_000)

// The first process is alive, inside the world, with its mail sent and not recorded. A second runtime on the file
// holds no fiber of the mail, so it takes the mail as a crash left it. It never sends the mail again.
test('a second runtime beside a process that still runs a mail: the mail is not sent twice, and is not known', () =>
  inDirectory(async (files) => {
    const kill = await stoppedAt(files, 'mail', 'World')
    try {
      expect(await settled(files)).toMatchObject({ mail: 'Unsure' })
      expect(acts(files)).toEqual(['mail'])
    } finally {
      await kill()
    }
  }), 30_000)
