/**
 * What a runtime writes: a `Stored<T>` in one database of SQLite or PostgreSQL, through `SqlClient` (decisions 0007,
 * 0019, 0157). The machine says what is stored; the storage says in which tables, and encodes it with the program's
 * schemas (decisions 0025, 0027). Every row carries the version of the program that wrote it, and is read by migrating
 * its JSON to the program's version (decision 0036). Nothing here decides anything: the machine encodes what an
 * event writes, and a caller writes it in one transaction (decision 0057).
 *
 * This module declares the storage of one program and makes it of its parts, each in the folder `storage/` and
 * divided by what it stores: the entities, their keys, the mailbox, the replies and the outbox in
 * [`entities.ts`](storage/entities.ts), and the read model in [`projections.ts`](storage/projections.ts). The tables,
 * the dialects and the transaction are in [`tables.ts`](storage/tables.ts), the rows as the runtime writes them in
 * [`rows.ts`](storage/rows.ts), and what the parts share in [`held.ts`](storage/held.ts). A module outside the
 * storage imports this one alone (decision 0241).
 */
import type * as Effect from 'effect/Effect'
import type { SqlClient } from 'effect/sql'
import type * as Machine from './machine.ts'
import type { Json, Program, Request, Types } from './program.ts'
import { type Due, entitiesOf, type Examined, type Inspection, type Suspended } from './storage/entities.ts'
import { heldOf } from './storage/held.ts'
import { type Found, projectionsOf, type Query, type Reindexed } from './storage/projections.ts'

export { type Suspended, type Suspension, type Waiting } from './storage/entities.ts'
export { batch } from './storage/rows.ts'
export { type After, type Comparison, type Criterion, type Found, type Query, type Reindexed } from './storage/projections.ts'
export { createTables, type Dialect, dialectOf, migrate, tablesMade, transaction } from './storage/tables.ts'

export interface Storage<T extends Types> {
  /**
   * Takes the lock of the entity `id` until the transaction it runs in ends, whether the entity is stored or not.
   * A step of the transactional runtime runs it first. On SQLite the transaction's `BEGIN IMMEDIATE` already holds
   * the one writer, and it does nothing.
   */
  readonly lock: (id: string) => Effect.Effect<void>
  /** What is stored for the entity `id`, its replies left out, or null when there is none (decision 0065). */
  readonly load: (id: string) => Effect.Effect<Machine.Stored<T> | null>
  /**
   * The reply stored for the entity `id` under `request`, or null for none: what a `Receive` is given
   * (decision 0065). A caller's reply past its time at `at`, in milliseconds, is none (decision 0125). `carried` is
   * the message a caller's request carried, read through the migrations of `inbound` at the program's version, and
   * null for another's (decision 0269).
   */
  readonly reply: (
    id: string,
    request: Request<T['sender']>,
    at: number,
  ) => Effect.Effect<Readonly<{ reply: Machine.StoredReply<T['rejection']>; carried: Json | null }> | null>
  /**
   * The answer kept for the operation's request `request` to the entity `id`, as a creation or a message by `kind`,
   * or null for none: a creation `init` rejected, or `NotFound`. No entity stores these, so the storage keeps them
   * for the operation while its work holds, and a run after a crash is given them again (decision 0253).
   */
  readonly answer: (
    id: string,
    kind: Machine.Answered,
    request: Machine.OperationRequest,
  ) => Effect.Effect<Machine.Unstored<T['rejection']> | null>
  /**
   * Keeps `answer` for the operation's request, as `answer` reads it, until the work that asked ends. The caller
   * wraps it in a transaction. An answer to work that has already ended is not kept (decision 0253).
   */
  readonly keepAnswer: (
    id: string,
    kind: Machine.Answered,
    request: Machine.OperationRequest,
    answer: Machine.Unstored<T['rejection']>,
  ) => Effect.Effect<void>
  /**
   * Writes what an event wrote, as the machine encoded it (decision 0057). The caller wraps it in the transaction
   * of the event (decision 0007). `at` is the time of the event, in milliseconds: the time the entity suspended,
   * where the event suspends it (decision 0114). It writes the step's row of the outbox where the storage was made
   * with the outbox.
   */
  readonly write: (id: string, written: Machine.Written, at: number) => Effect.Effect<void>
  /**
   * The entities whose state holds an operation, or whose mailbox holds a message: what a process activates when
   * it starts, without waiting for a caller. So an operation a crash interrupted runs again, and a message a
   * crash left before its step is handled. A timer needs no activation of its own, since its time is stored and
   * `due` gives it. A suspended entity handles nothing until an operator resumes it, and is left out (decisions 0006,
   * 0029, 0071).
   */
  readonly interrupted: Effect.Effect<ReadonlyArray<string>>
  /**
   * The stored timers: the entities with a timer due by `now`, and the earliest time past it. A suspended entity is
   * left out, since no timer of its fires (decision 0029).
   */
  readonly due: (now: number) => Effect.Effect<Due>
  /**
   * Creates one expression index per index the program declares, so that a query over it is a lookup. Run once,
   * where the program is deployed: an index the program no longer declares is left behind, and costs nothing.
   */
  readonly indexed: Effect.Effect<void>
  /** The entities of the program whose indexes match, with what callers read of them (decision 0032). */
  readonly query: (query: Query<T>) => Effect.Effect<ReadonlyArray<Found<T>>>
  /** `Handle.read`, as the storage keeps it: the projection of the entity's row, or null for none (decision 0121). */
  readonly projected: (id: string) => Effect.Effect<T['projection'] | null>
  /**
   * `Handle.reindex`, as the storage keeps it. Each row is its own write, so a crash leaves the rest to the next
   * run. It gives how many were written, and the entities whose row the program could not compute, which keep
   * theirs (decision 0122). A row is written only if the state it was computed from is still the one stored: an
   * entity that took a step since wrote its own (decision 0070).
   */
  readonly reindex: Effect.Effect<Reindexed>
  /**
   * `Handle.expire`: deletes the callers' replies past their time at `at`, in milliseconds, and the replies and the
   * answers kept for work that has ended, in batches, and counts them (decisions 0245, 0289). It deletes no row of
   * the outbox.
   */
  readonly expire: (at: number) => Effect.Effect<number>
  /**
   * The suspended entities of the program, the longest suspended first, each with its waits, from one snapshot
   * outside a transaction the caller left open, and at the caller's level within one (decisions 0114, 0265).
   */
  readonly suspended: Effect.Effect<ReadonlyArray<Suspended>>
  /**
   * What is stored for the entity `id`, read as `load` reads it, with its suspension as `suspended` lists it, or null
   * when there is none. Every row is read from one snapshot, so a step that commits meanwhile is read whole or not
   * at all. Within a transaction the caller left open, the rows are read at the caller's level (decision 0185).
   */
  readonly inspect: (id: string) => Effect.Effect<Inspection<T> | null>
  /**
   * For `check`: what is stored for the entity `id`, read as `inspect` reads it, from one snapshot, or the cause of
   * what the program read of a row and died on, or null when there is none. What the runtime throws, a row that is
   * no JSON included, fails the call (decision 0247).
   */
  readonly examine: (id: string) => Effect.Effect<Examined<T> | null>
  /**
   * For `check`: a page of the program's entities past the id `after`, by id, each with whether it is suspended
   * (decision 0247).
   */
  readonly entities: (after: string) => Effect.Effect<ReadonlyArray<Readonly<{ id: string; suspended: boolean }>>>
}

/**
 * The storage of one program's entities, on one client, with its schemas read once. Where `outbox` is true, each
 * creation and each step whose projection changed writes its row of the outbox.
 */
export const storage = <T extends Types>(
  program: Program<T>,
  sql: SqlClient.SqlClient,
  outbox: boolean = false,
): Storage<T> => {
  const held = heldOf(program, sql)
  return { ...entitiesOf(held, outbox), ...projectionsOf(held) }
}
