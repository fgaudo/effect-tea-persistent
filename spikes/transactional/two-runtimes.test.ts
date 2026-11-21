/**
 * Two runtimes on one file of SQLite lose no step. Two processes each send one desk the same number of messages, at
 * once, and the desk counts every one of them. Each step reads the desk under the file's write lock before it
 * writes, so neither process writes over a step of the other.
 *
 * The same test fails on the runtime of today, which steps an entity from its copy in memory: one runtime holds
 * the file, and the launch of a second is refused.
 */
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { expect, test } from 'bun:test'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { SqlClient } from 'effect/sql'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as library from '../../src/index.ts'
import type { TypesOf } from '../../src/index.program.ts'
import { desk, World } from './desk.ts'
import { type Handle, launch } from '../../src/transactional.ts'

const world = Layer.succeed(World, World.of({ act: () => Effect.void }))

const each = 100

/**
 * The desk's count, how the second process ended, and how many times the steps passed from one process to the
 * other, once both processes sent `each` messages on one file.
 */
const counted = async (kind: 'spike' | 'today') => {
  const directory = mkdtempSync(join(tmpdir(), 'effect-tea-persistent-two-runtimes-'))
  const filename = join(directory, 'store.db')
  try {
    return await Effect.runPromise(
      Effect.scoped(Effect.gen(function*() {
        const desks: Handle<TypesOf<typeof desk>> = yield* Effect.provide(
          kind === 'today'
            ? Effect.flatMap(library.launch(), (runtime) => runtime.deploy(desk))
            : Effect.flatMap(launch(), (runtime) => runtime.deploy(desk)),
          world,
        )
        yield* desks.create('d', { requestId: 'create' })
        const second = Bun.spawn(
          ['bun', join(import.meta.dir, 'two-runtimes.child.ts'), filename, kind, String(each)],
          { stdout: 'pipe', stderr: 'ignore' },
        )
        // The first process sends once the second has launched, or has ended without launching.
        yield* Effect.promise(() => second.stdout.getReader().read())
        for (let sent = 0; sent < each; sent++) {
          yield* desks.send('d', { _tag: 'Added' }, { requestId: `first-${sent}`, keep: 'forever' })
          yield* Effect.sleep('1 millis')
        }
        const code = yield* Effect.promise(() => second.exited)
        // Each step stored its request's reply: the replies, in the order of their writing, say whose step was when.
        const sql = yield* SqlClient.SqlClient
        const replies = yield* sql<{ request: string }>`SELECT request FROM effecttea_replies ORDER BY rowid`
        const writers = replies.map(({ request }) => request.includes('first-'))
        const turns = writers.filter((first, at) => at > 0 && first !== writers[at - 1]).length
        return { code, count: (yield* desks.read('d'))?.count, turns }
      })).pipe(Effect.provide(SqliteClient.layer({ filename }))),
    )
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

test('two runtimes on one file lose no step', async () => {
  const { turns, ...ended } = await counted('spike')
  expect(ended).toEqual({ code: 0, count: 2 * each })
  // The two processes stepped the desk by turns, and not one after the other.
  expect(turns).toBeGreaterThan(2)
}, 60_000)

test.failing('the runtime of today on the same test: the second launch is refused', async () => {
  expect(await counted('today')).toMatchObject({ code: 0, count: 2 * each })
}, 60_000)
