/**
 * What `operating` of `src/runtime.ts` rests on, at `effect` 4.1.3. A scope's state is `Closed` from the start of its
 * closing, so a fiber forked in it and interrupted by the closing reads `Closed` as it ends. The runtime then tells
 * a run that the process stops from a run that ended interrupted by itself, which dies.
 */
import { expect, test } from 'bun:test'
import * as Deferred from 'effect/Deferred'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Scope from 'effect/Scope'

test('a fiber that its scope interrupts reads the scope closed as it ends', () =>
  Effect.runPromise(Effect.gen(function*() {
    const scope = yield* Scope.make()
    const started = yield* Deferred.make<void>()
    const seen: Array<string> = []
    yield* Effect.forkIn(
      Effect.andThen(Deferred.succeed(started, undefined), Effect.never).pipe(
        Effect.onExit(() => Effect.sync(() => seen.push(scope.state._tag))),
      ),
      scope,
    )
    yield* Deferred.await(started)
    seen.push(scope.state._tag)
    yield* Scope.close(scope, Exit.void)
    expect(seen).toEqual(['Open', 'Closed'])
  })))
