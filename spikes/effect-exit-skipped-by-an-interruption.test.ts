/**
 * What `operating` of `src/runtime.ts` rests on, at `effect` 4.1.3. A fiber that is interrupted from outside, and is
 * interruptible, ends without running what follows `Effect.exit`, whether its scope closes or `Fiber.interrupt`
 * stops it. A run that interrupts itself reaches what follows `Effect.exit`. So the runtime records nothing for a run
 * it interrupts, and a death for a run that ends interrupted by itself.
 */
import { expect, test } from 'bun:test'
import * as Cause from 'effect/Cause'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Fiber from 'effect/Fiber'
import * as Scope from 'effect/Scope'

/** A run as the runtime forks it: interruptible in `scope`, recording the exit of `operation` in `seen`. */
const forked = (scope: Scope.Scope, operation: Effect.Effect<void>, seen: Array<Exit.Exit<void>>) =>
  Effect.forkIn(
    Effect.flatMap(Effect.exit(operation), (exit) => Effect.sync(() => seen.push(exit))),
    scope,
    { uninterruptible: false },
  )

test('a fiber that Fiber.interrupt stops does not run what follows Effect.exit', () =>
  Effect.runPromise(Effect.gen(function*() {
    const scope = yield* Scope.make()
    const started = yield* Deferred.make<void>()
    const seen: Array<Exit.Exit<void>> = []
    const fiber = yield* forked(scope, Effect.andThen(Deferred.succeed(started, undefined), Effect.never), seen)
    yield* Deferred.await(started)
    const exit = yield* Fiber.interrupt(fiber).pipe(Effect.andThen(Fiber.await(fiber)))
    expect(seen).toEqual([])
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    yield* Scope.close(scope, Exit.void)
  })))

test('a fiber that its closing scope interrupts does not run what follows Effect.exit', () =>
  Effect.runPromise(Effect.gen(function*() {
    const scope = yield* Scope.make()
    const started = yield* Deferred.make<void>()
    const seen: Array<Exit.Exit<void>> = []
    const fiber = yield* forked(scope, Effect.andThen(Deferred.succeed(started, undefined), Effect.never), seen)
    yield* Deferred.await(started)
    yield* Scope.close(scope, Exit.void)
    const exit = yield* Fiber.await(fiber)
    expect(seen).toEqual([])
    expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
  })))

test('a fiber whose operation interrupts itself runs what follows Effect.exit', () =>
  Effect.runPromise(Effect.gen(function*() {
    const scope = yield* Scope.make()
    const seen: Array<Exit.Exit<void>> = []
    const fiber = yield* forked(scope, Effect.interrupt, seen)
    yield* Fiber.await(fiber)
    expect(seen.length).toBe(1)
    const [exit] = seen
    expect(exit !== undefined && Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
    yield* Scope.close(scope, Exit.void)
  })))
