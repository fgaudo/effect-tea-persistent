/**
 * The histories of `machine.test_histories.ts`, played on the machine. The target stores the replies as a storage
 * does, from what each step writes, and handles the mailbox to its end after each act, unless the entity is
 * suspended.
 */
import { expect, test } from 'bun:test'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import fc from 'fast-check'
import * as Machine from './machine.ts'
import {
  type Answer,
  first,
  history,
  type Inbound,
  type Operation,
  play,
  sameRun,
  type T,
  type Target,
  toy,
  type Version,
  violations,
} from './machine.test_histories.ts'
import type { Json, Program, Request } from './program.ts'

const creation: Request<null> = { _tag: 'Caller', sender: null, id: 'creation' }

const onMachine = (): Target => {
  let deployed: Program<T> = toy(first)
  let now = DateTime.makeUnsafe(0)
  const created = Machine.start(deployed, 'history', null, now, creation)
  if (created._tag !== 'Created') throw new Error(`the toy was not created: ${created._tag}`)
  let machine = created.machine
  const replies = new Map<string, Machine.StoredReply<T['rejection']>>()
  const carried = new Map<string, Json | null>()
  // Each run the machine started, with its key and incarnation, which an answer of the run is stepped under.
  const starts: Array<Readonly<{ run: Operation; key: Machine.Run<T>['key']; incarnation: number }>> = []

  const seen = (outputs: ReadonlyArray<Machine.Output<T>>, written: Machine.Written | null) => {
    for (const output of outputs) {
      if (output._tag === 'Started') {
        starts.push({ run: output.operation, key: output.key, incarnation: output.incarnation })
      }
    }
    for (const row of written?.replies ?? []) {
      carried.set(row.request, row.carried)
      replies.set(
        row.request,
        row.tag === 'Accepted' ? { _tag: 'Accepted' } : { _tag: 'Rejected', reason: row.reason as T['rejection'] | null },
      )
    }
  }
  /** Handles the mailbox to its end after `transition`, unless the entity is suspended, and gives every output. */
  const settle = (transition: Omit<Machine.Transition<T>, 'written'> & Readonly<{ written: Machine.Written | null }>) => {
    seen(transition.outputs, transition.written)
    const outputs = [...transition.outputs]
    let { machine: next } = transition
    while (next.stored.suspension === null && next.stored.mailbox.length > 0) {
      const handled = Machine.step(deployed, next, { _tag: 'Handle', at: now })
      seen(handled.outputs, handled.written)
      outputs.push(...handled.outputs)
      next = handled.machine
    }
    machine = next
    return outputs
  }
  // A creation whose at-most-once operation is given `unknown` would leave it in the mailbox.
  settle(created)

  const step = (event: Machine.Event<T>) => settle(Machine.step(deployed, machine, event))

  /** A deploy is a restart by the new version, which a suspended entity stays suspended through (decision 0064). */
  const deploy = (version: Version | null) => {
    if (version === null) return
    deployed = toy(version)
    step({ _tag: 'Restart' })
  }

  // The last start of the run: one started again after a crash keeps its incarnation.
  const startOf = (run: Operation) => [...starts].reverse().find((start) => sameRun(start.run, run))

  return {
    send: (requestId: string, message: Inbound) =>
      Effect.sync((): Answer => {
        const request: Request<null> = { _tag: 'Caller', sender: null, id: requestId }
        const key = Machine.requestKey(deployed, request)
        const outputs = step({
          _tag: 'Receive',
          request,
          message,
          reply: replies.get(key) ?? null,
          carried: carried.get(key) ?? null,
          at: now,
        })
        const waited = Machine.messageKey(deployed, request, message)
        for (const output of outputs) {
          if (output._tag === 'Replied' && Machine.messageKey(deployed, output.request, output.message) === waited) {
            return output.reply
          }
        }
        throw new Error(`${requestId} was not answered`)
      }),
    running: Effect.sync(() =>
      // A run whose key holds no work is skipped, so that a machine that lost it fails a check and not the target.
      Object.entries(machine.running).flatMap(([text, running]) => {
        const work = machine.stored.keys[text]?.work
        return running.kind === 'Operation' && work !== undefined ? [work as Operation] : []
      })
    ),
    started: Effect.sync(() => starts.map(({ run }) => run)),
    complete: (run, then) =>
      Effect.sync(() => {
        const start = startOf(run)
        if (start === undefined) return
        step({
          _tag: 'Complete',
          key: start.key,
          incarnation: start.incarnation,
          message: { _tag: 'Done', run, then },
        })
      }),
    die: (run) =>
      Effect.sync(() => {
        const start = startOf(run)
        if (start === undefined) return
        step({ _tag: 'Die', key: start.key, incarnation: start.incarnation, cause: 'the run died' })
      }),
    advance: (millis) =>
      Effect.sync(() => {
        const until = DateTime.addDuration(now, millis)
        // A timer under `t` arms itself again a period after it fires, so the loop ends within the duration.
        for (let fired = 0; fired < 1_000; fired++) {
          const due = Machine.nextTimer(machine, until)
          if (due === undefined) break
          now = DateTime.max(now, due.at)
          step({ _tag: 'Fire', key: due.key, incarnation: due.incarnation })
        }
        now = DateTime.max(now, until)
      }),
    restart: (version) =>
      Effect.sync(() => {
        if (version === null) step({ _tag: 'Restart' })
        else deploy(version)
      }),
    resume: (version) =>
      Effect.sync(() => {
        deploy(version)
        step({ _tag: 'Resume' })
      }),
    discard: (version) =>
      Effect.sync(() => {
        deploy(version)
        step({ _tag: 'Discard' })
      }),
    read: Effect.sync(() => deployed.project(machine.stored.state)),
    suspended: Effect.sync(() => machine.stored.suspension !== null),
  }
}

test('a history on the machine keeps the promises of the design', () =>
  fc.assert(
    fc.property(history, (acts) => {
      expect(violations(Effect.runSync(play(acts, onMachine())))).toEqual([])
    }),
    // The report names the promise the shrunk history broke.
    { numRuns: Bun.env['SCHEDULES'] === 'all' ? 50_000 : 10_000, includeErrorInReport: true },
  ), 60_000)

