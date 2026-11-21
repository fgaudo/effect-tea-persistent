/**
 * How a test of `transactional.ts` waits until the runtime has nothing left to do but wait for an answer or a time.
 * The test runs under `quietly`, so every fiber runs on Effect's scheduler in its `sync` mode, which runs a task in a
 * microtask. SQLite answers in the call itself, so the runtime's work ends within the microtasks, and a task of the
 * host's timers runs once they are all done. A store that answers on the network needs another wait.
 */
import * as Effect from 'effect/Effect'
import * as Scheduler from 'effect/Scheduler'

/** Ends once the runtime's work on SQLite has ended, for a test run by `quietly`. */
export const quiet: Effect.Effect<void> = Effect.promise(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))

/** Runs `effect` with every fiber it forks on the scheduler that `quiet` waits for. */
export const quietly = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
  Effect.provideService(effect, Scheduler.Scheduler, new Scheduler.MixedScheduler('sync'))
