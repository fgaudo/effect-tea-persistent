/**
 * The subscription of `examples/subscription` on the spike's runtime, since the example has no test on a runtime.
 * Its renewal is a timer a month away. No entity is held in memory, so the renewal is a row of the storage, which
 * the one fiber that waits on time fires once the clock passes it.
 */
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { expect, test } from 'bun:test'
import * as Effect from 'effect/Effect'
import * as Layer from 'effect/Layer'
import { TestClock } from 'effect/testing'
import { Payments, subscription } from '../../examples/subscription/subscription.ts'
import { launch } from '../../src/transactional.ts'

const ada = { _tag: 'Customer', id: 'ada' } as const

test('a subscription is charged at its creation, and again when its stored renewal comes due', () =>
  Effect.runPromise(
    Effect.scoped(Effect.gen(function*() {
      const charges: Array<string> = []
      const payments = Layer.succeed(
        Payments,
        Payments.of({
          charge: ({ idempotencyKey }) =>
            Effect.sync(() => {
              charges.push(idempotencyKey)
              return 'ch_1'
            }),
        }),
      )
      const runtime = yield* launch()
      const subscriptions = yield* Effect.provide(runtime.deploy(subscription), payments)
      const flags = { customer: 'ada', payment: 'card-1', plan: { name: 'Basic', priceInCents: 900 } }
      expect(yield* subscriptions.create('s-1', { flags, requestId: 'c-1', sender: ada })).toEqual({ _tag: 'Created' })
      yield* runtime.settled
      const first = yield* subscriptions.read('s-1')
      expect(first).toMatchObject({ status: 'Active' })

      // A day before the renewal nothing is due, and the day after it the renewal has fired and charged.
      yield* TestClock.adjust('27 days')
      yield* runtime.settled
      expect(charges.length).toBe(1)
      yield* TestClock.adjust('5 days')
      yield* runtime.settled
      const second = yield* subscriptions.read('s-1')
      expect(second).toMatchObject({ status: 'Active' })
      expect(second?.paidUntil ?? 0).toBeGreaterThan(first?.paidUntil ?? 0)
      // Each charge ran once, under the idempotency key of its own run.
      expect(new Set(charges).size).toBe(2)
      expect(charges.length).toBe(2)
    })).pipe(Effect.provide([SqliteClient.layer({ filename: ':memory:' }), TestClock.layer()])),
  ))
