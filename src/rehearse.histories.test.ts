/**
 * The histories of `machine.test_histories.ts`, played on a rehearsal. A rehearsal runs the runtime's step, so it
 * keeps the promises the runtime keeps: this is the test that fails if it answers otherwise again. An act that
 * suspends the entity fails with `EntitySuspended`, which the target reads as a send answered `Suspended`.
 */
import { expect, test } from 'bun:test'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import fc from 'fast-check'
import {
  type Answer,
  first,
  history,
  type Inbound,
  keys,
  type Operation,
  play,
  type Played,
  type Runner,
  sameRun,
  type T,
  type Target,
  toy,
  type Version,
  violations,
} from './machine.test_histories.ts'
import { isTimer } from './program.ts'
import { EntitySuspended, type Pending, watched } from './rehearse.ts'

/** `effect`, or `suspended` where it fails with the suspension of an entity. */
const unless = <A, B>(effect: Effect.Effect<A>, suspended: B): Effect.Effect<A | B> =>
  Effect.catchDefect(effect, (defect) =>
    defect instanceof EntitySuspended ? Effect.succeed(suspended) : Effect.die(defect))

const played = (acts: Parameters<typeof play>[0]) =>
  Effect.gen(function*() {
    let result: Played | undefined
    // Each run a committed step started, in order, with the key and the incarnation an answer of it is given under.
    const starts: Array<Pending<Operation>> = []
    // The runner of a run the history kills dies, and no other runner is run: the target answers the others.
    const dies: Runner = () => Effect.die('the run died')
    const watch = { started: (_: unknown, pending: Pending) => void starts.push(pending as Pending<Operation>) }
    yield* watched(DateTime.makeUnsafe(0), watch, (world) =>
      Effect.gen(function*() {
        const entity = yield* world.create(toy(first, dies), 'history')
        const deployed = (version: Version | null) =>
          version === null ? Effect.void : unless(world.deploy(toy(version, dies)), undefined)
        const startOf = (run: Operation) => {
          for (let at = starts.length - 1; at >= 0; at--) if (sameRun(starts[at]!.work, run)) return starts[at]
          return undefined
        }
        const target: Target = {
          send: (requestId: string, message: Inbound) =>
            unless(entity.send(message, { requestId }) as Effect.Effect<Answer>, { _tag: 'Suspended' } as const),
          running: Effect.gen(function*() {
            const runs: Array<Operation> = []
            for (const key of keys) {
              const under = yield* entity.underWay(key)
              if (under !== null && !isTimer(under.work)) runs.push(under.work as Operation)
            }
            return runs
          }),
          started: Effect.sync(() => starts.map(({ work }) => work)),
          // A run no longer under way is answered under its own incarnation, which the step drops.
          complete: (run, then) =>
            Effect.suspend(() => {
              const start = startOf(run)
              return start === undefined
                ? Effect.void
                : Effect.asVoid(unless(entity.answer(start, { _tag: 'Done', run, then }), undefined))
            }),
          die: (run) =>
            Effect.suspend(() => {
              const start = startOf(run)
              return start === undefined ? Effect.void : Effect.asVoid(unless(entity.run(start), undefined))
            }),
          advance: (millis) => unless(world.advance(millis), undefined),
          restart: (version) => version === null ? unless(world.restart, undefined) : deployed(version),
          resume: (version) => Effect.andThen(deployed(version), Effect.asVoid(entity.resume)),
          discard: (version) => Effect.andThen(deployed(version), Effect.asVoid(entity.discard)),
          read: entity.projection as Effect.Effect<T['projection']>,
          suspended: Effect.map(entity.suspension, (suspension) => suspension !== null),
        }
        result = yield* play(acts, target)
      }))
    return result!
  })

test('a history on a rehearsal keeps the promises of the design', () =>
  fc.assert(
    fc.asyncProperty(history, async (acts) => {
      expect(violations(await Effect.runPromise(played(acts)))).toEqual([])
    }),
    { numRuns: Bun.env['SCHEDULES'] === 'all' ? 10_000 : 500, includeErrorInReport: true },
  ), 60_000)
