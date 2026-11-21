/**
 * The entities of a program as the storage keeps them: the rows of `effecttea_entities`, their keys in
 * `effecttea_entity_keys`, the mailbox and the replies. A step's `write` lies here, since a step writes its entity's
 * row first, and then the read model and the outbox.
 */
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Result from 'effect/Result'
import * as Schema from 'effect/Schema'
import * as Machine from '../machine.ts'
import type { Address, Json, Key, Request, Types } from '../program.ts'
import type { Storage } from '../storage.ts'
import type { Held } from './held.ts'
import { rowOf } from './projections.ts'
import { batch, callerOf, Count, type Guard, keyOfRow, keyRow, reasonOf, Rows, unguarded } from './rows.ts'
import { transaction } from './tables.ts'

/**
 * A suspended entity, as an operator sees it: what it died on, the cause as it was rendered when the entity
 * suspended, and since when, by the runtime's clock (decision 0114).
 */
export type Suspension = Readonly<{
  id: string
  /** The mailbox's first message, with its kind, an operation, or the activation of the stored state. */
  on:
    | Readonly<{ _tag: 'Message'; kind: 'Inbound' | 'Internal' }>
    | Readonly<{ _tag: 'Operation'; key: Key; incarnation: number }>
    | Readonly<{ _tag: 'Activation' }>
  cause: string
  since: DateTime.Utc
}>

/** What is stored of one entity, as an operator sees it: the suspension as `suspended` lists it (decision 0185). */
/**
 * An operation of another entity whose `send` waits for the entity's resumption: its run, and the name it sent
 * under (decisions 0114, 0265).
 */
export type Waiting = Readonly<{ entity: Address; key: Key; incarnation: number; name: string }>

/**
 * A suspended entity, as `Handle.suspended` lists it: what the storage holds of the suspension, and the operations
 * stored as waiting for its resumption whose run still holds (decision 0265).
 */
export type Suspended = Suspension & Readonly<{ waiting: ReadonlyArray<Waiting> }>

export type Inspection<T extends Types> = Readonly<{ stored: Machine.Stored<T>; suspension: Suspended | null }>

/**
 * One entity as `check` reads it: what is stored, or the cause of what the program read of a row and died on, a
 * migration or a schema (decision 0247).
 */
export type Examined<T extends Types> =
  | Readonly<{ _tag: 'Read'; stored: Machine.Stored<T> }>
  | Readonly<{ _tag: 'Unread'; cause: string }>

/** What the program read of a row and died on, thrown out of the reading for `examine` to catch. */
class Unread {
  constructor(readonly reason: string) {}
}

/** The entities an unloaded timer is due for, and the next time one is (decision 0029). */
export type Due = Readonly<{
  /** The entities with a stored timer due at or before the time asked: each is activated, and its timer fires. */
  ready: ReadonlyArray<string>
  /** The earliest time a stored timer of another entity is due, by which the process sleeps, or null for none. */
  next: number | null
  /**
   * The entities whose earliest time no integer is, as a row no version writes: each with the reason its row is
   * refused. The reading goes on past them, and the waker tries each again after `retry` (decision 0259).
   */
  refused: ReadonlyArray<Readonly<{ id: string; reason: string }>>
}>

/**
 * The part of the storage of one program that reads and writes its entities. `outbox` says whether a step writes
 * its row of the outbox.
 */
export const entitiesOf = <T extends Types>(held: Held<T>, outbox: boolean): Pick<
  Storage<T>,
  | 'lock'
  | 'load'
  | 'reply'
  | 'answer'
  | 'keepAnswer'
  | 'write'
  | 'interrupted'
  | 'due'
  | 'expire'
  | 'suspended'
  | 'inspect'
  | 'examine'
  | 'entities'
> => {
  const { program, sql, name, version, upsert, rows, up, upRequest, upReason, readWork, snapshot } = held
  const { lockingTheConditionSkipping, dialect } = held
  const { state, inbound, internal, flags, request, reason, suspended } = held.codecs
  const row = rowOf(held)
  const encodeReason = Schema.encodeSync(reasonOf(program.schemas.rejection))

  /**
   * The entity's rows, read through the migrations, and its cause and the time it suspended, if it is. What the
   * program reads of a row runs inside `guard`.
   */
  const entity = (id: string, guard: Guard = unguarded) =>
    Effect.gen(function*() {
      const entities = yield* rows('effecttea_entities', Rows.entity)(
        sql`SELECT state, version, creation, flags, incarnations, suspended_on, suspended_cause, suspended_at
            FROM effecttea_entities WHERE name = ${name} AND id = ${id}`,
      )
      const row = entities[0]
      if (row === undefined) return null
      const held = yield* rows('effecttea_entity_keys', Rows.key)(
        sql`SELECT key, parameter, incarnation, version, work, delivery FROM effecttea_entity_keys
            WHERE name = ${name} AND id = ${id}`,
      )
      const queued = yield* rows('effecttea_mailbox', Rows.envelope)(
        sql`SELECT tag, version, message, request, keep, key, parameter, incarnation FROM effecttea_mailbox
            WHERE name = ${name} AND id = ${id} ORDER BY seq`,
      )
      const keys: Record<string, Machine.Run<T>> = {}
      for (const row of held) {
        const key = keyOfRow(row.key, row.parameter)
        keys[Machine.keyText(key)] = {
          key,
          incarnation: row.incarnation,
          work: readWork(row.work, row.version, guard),
          ...(row.delivery === null ? {} : { delivery: row.delivery }),
        }
      }
      const mailbox = queued.map((envelope): Machine.Envelope<T> =>
        envelope.tag === 'Inbound'
          ? {
            _tag: 'Inbound',
            request: request.read(envelope.request, upRequest(envelope.version), guard),
            message: inbound.read(envelope.message, up('inbound', envelope.version), guard),
            ...(envelope.keep === null ? {} : { keep: envelope.keep }),
          }
          : {
            _tag: 'Internal',
            key: keyOfRow(envelope.key, envelope.parameter),
            incarnation: envelope.incarnation,
            message: internal.read(envelope.message, up('internal', envelope.version), guard),
          }
      )
      const stored = {
        name,
        id,
        state: state.read(row.state, up('state', row.version), guard),
        keys,
        incarnations: row.incarnations,
        mailbox,
        creation: request.read(row.creation, upRequest(row.version), guard),
        // Read through the migrations, and not decoded: a retry of the creation is compared with the text, and a
        // schema of the flags that no longer reads them leaves the entity as it was (decision 0269).
        flags: up('flags', row.version)(JSON.parse(row.flags) as Json),
        // The cause is what was rendered when the entity suspended: an operator reads it, nothing acts on it.
        suspension: row.suspended_on === null
          ? null
          : { cause: row.suspended_cause, on: suspended.read(row.suspended_on) },
      } satisfies Machine.Stored<T>
      return {
        stored,
        held: row.suspended_on === null ? null : { cause: row.suspended_cause, at: row.suspended_at },
      }
    })

  // An advisory lock holds an entity that has no row yet, so that two creations wait for each other. Its two keys
  // of four bytes are held apart from the one key of eight bytes that holds a database. The transaction is at
  // `READ COMMITTED`, so each statement after the lock reads what the transaction that held it committed.
  const lock = (id: string) =>
    dialect === 'pg'
      ? Effect.orDie(Effect.asVoid(sql`SELECT pg_advisory_xact_lock(hashtext(${name}), hashtext(${id}))`))
      : Effect.void

  const load = (id: string) => entity(id).pipe(Effect.map((found) => found?.stored ?? null), Effect.orDie)

  // The rows are read from one snapshot, so that a step between two readings is not read in half (decision 0185).
  const inspect = (id: string): Effect.Effect<Inspection<T> | null> =>
    snapshot(Effect.all([entity(id), waitingOf(id)])).pipe(
      Effect.flatMap(([found, waiting]): Effect.Effect<Inspection<T> | null> => {
        if (found === null) return Effect.succeed(null)
        const { stored, held } = found
        if (stored.suspension === null || held === null) return Effect.succeed({ stored, suspension: null })
        return Effect.map(
          listedAs(id, stored.suspension.on, stored.mailbox[0]?._tag ?? null, held.cause, held.at),
          (suspension) => ({ stored, suspension: { ...suspension, waiting: waiting.get(id) ?? [] } }),
        )
      }),
      Effect.orDie,
    )

  // What the program reads of a row and dies on is told apart from what the runtime throws, a row that is no JSON
  // included, which still fails the call (decisions 0122, 0247).
  const examine = (id: string): Effect.Effect<Examined<T> | null> =>
    snapshot(entity(id, (read) => {
      try {
        return read()
      } catch (thrown) {
        throw new Unread(Machine.render(thrown))
      }
    })).pipe(
      Effect.map((found): Examined<T> | null => found === null ? null : { _tag: 'Read', stored: found.stored }),
      Effect.catchDefect((defect) =>
        defect instanceof Unread ? Effect.succeed({ _tag: 'Unread', cause: defect.reason } as const) : Effect.die(defect)
      ),
      Effect.orDie,
    )

  const entities = (after: string) =>
    rows('effecttea_entities', Rows.listed)(sql`
      SELECT id, CASE WHEN suspended_on IS NULL THEN 0 ELSE 1 END AS suspended FROM effecttea_entities
      WHERE name = ${name} AND id > ${after} ORDER BY id LIMIT ${batch}
    `).pipe(
      Effect.map((page) => page.map(({ id, suspended }) => ({ id, suspended: suspended > 0 }))),
      Effect.orDie,
    )

  /**
   * The reply among `found` stored under the request `key`, as this version keys it: a row is compared once read
   * through the migrations, since only a caller's sender is the program's, and may be migrated (decision 0059).
   */
  const replyOf = (found: Effect.Success<ReturnType<typeof Rows.reply>>, key: string) => {
    for (const held of found) {
      if (Machine.requestKey(program, request.read(held.request, upRequest(held.version))) !== key) continue
      const reply = held.tag === 'Accepted'
        ? { _tag: 'Accepted' } as const
        : {
          _tag: 'Rejected',
          reason: held.reason === null ? null : reason.read(held.reason, upReason(held.version)),
        } as const
      // What the request carried is read through the migrations, and not decoded, as the creation's flags are
      // (decision 0269).
      const carried = held.carried === null ? null : up('inbound', held.version)(JSON.parse(held.carried) as Json)
      return { reply, carried }
    }
    return null
  }

  // A request is found by its text, as the machine keys it. A caller's request is then looked for among the rows
  // other versions wrote under its request id, since its sender as such a version wrote it may be another text.
  // Each reading is by an index (decision 0065). A reply past its time at `at` is not read, whether its row is
  // deleted yet or not (decision 0125).
  const reply = (id: string, asked: Request<T['sender']>, at: number) =>
    Effect.gen(function*() {
      const key = Machine.requestKey(program, asked)
      const exact = replyOf(
        yield* rows('effecttea_replies', Rows.reply)(sql`
          SELECT request, carried, tag, version, reason FROM effecttea_replies
          WHERE name = ${name} AND id = ${id} AND request = ${key} AND (until IS NULL OR until > ${at})
        `),
        key,
      )
      if (exact !== null || asked._tag !== 'Caller') return exact
      return replyOf(
        yield* rows('effecttea_replies', Rows.reply)(sql`
          SELECT request, carried, tag, version, reason FROM effecttea_replies
          WHERE name = ${name} AND id = ${id} AND request_id = ${asked.id} AND version <> ${version}
            AND (until IS NULL OR until > ${at})
        `),
        key,
      )
    }).pipe(Effect.orDie)

  // Kept under the receiver and the request, by `kind`, so that a creation and a message an operation names alike
  // keep an answer each (decision 0253).
  const answer = (id: string, kind: Machine.Answered, asked: Machine.OperationRequest) =>
    Effect.gen(function*() {
      const found = yield* rows('effecttea_answers', Rows.answer)(sql`
        SELECT tag, version, reason FROM effecttea_answers
        WHERE name = ${name} AND id = ${id} AND request = ${Machine.requestKey(program, asked)} AND kind = ${kind}
      `)
      const held = found[0]
      if (held === undefined) return null
      return held.tag === 'NotFound'
        ? { _tag: 'NotFound' } as const
        : {
          _tag: 'Rejected',
          reason: held.reason === null ? null : reason.read(held.reason, upReason(held.version)),
        } as const
    }).pipe(Effect.orDie)

  // Written in the caller's transaction. The answer of work that already ended goes as it is written, as a reply
  // to such work does, since no step of the work's entity is left to delete it (decisions 0021, 0253).
  const keepAnswer = (
    id: string,
    kind: Machine.Answered,
    asked: Machine.OperationRequest,
    given: Machine.Unstored<T['rejection']>,
  ) =>
    Effect.gen(function*() {
      const asking = keyRow(asked.key)
      const request = Machine.requestKey(program, asked)
      yield* upsert('effecttea_answers', ['name', 'id', 'request', 'kind'], {
        name,
        id,
        request,
        kind,
        tag: given._tag,
        version,
        reason: given._tag === 'Rejected' && given.reason !== null ? JSON.stringify(encodeReason(given.reason)) : null,
        sender_name: asked.entity.name,
        sender_id: asked.entity.id,
        sender_key: asking.key,
        sender_parameter: asking.parameter,
        sender_incarnation: asked.incarnation,
      })
      yield* sql`
        DELETE FROM effecttea_answers
        WHERE name = ${name} AND id = ${id} AND request = ${request} AND kind = ${kind}
          AND NOT EXISTS (
            SELECT 1 FROM effecttea_entity_keys AS asking
            WHERE asking.name = ${asked.entity.name} AND asking.id = ${asked.entity.id} AND asking.key = ${asking.key}
              AND asking.parameter = ${asking.parameter} AND asking.incarnation = ${asked.incarnation}
          )
      `
    }).pipe(Effect.orDie)

  const write = (id: string, written: Machine.Written, at: number) =>
    Effect.gen(function*() {
      const { entity, suspension } = written
      const state = entity === null ? null : JSON.stringify(entity.state)
      let characters = state?.length ?? 0
      const on = suspension === null ? null : JSON.stringify(suspension.on)
      const cause = suspension === null ? null : suspension.cause
      if (written.created) {
        if (entity === null) throw new Error(`the entity '${name}' '${id}' is created with no state`)
        yield* sql`INSERT INTO effecttea_entities ${
          sql.insert({
            name,
            id,
            state,
            version,
            creation: JSON.stringify(entity.creation),
            flags: JSON.stringify(entity.flags),
            incarnations: written.incarnations,
            suspended_on: on,
            suspended_cause: cause,
            suspended_at: on === null ? null : at,
            steps: 1,
          })
        }`
      } else if (entity !== null) {
        // The request that created the entity is written with the state, at the version that reads both. The time
        // of the suspension is the first step's that suspended the entity, kept while it stays suspended (decision
        // 0114).
        yield* sql`
          UPDATE effecttea_entities
          SET state = ${state}, version = ${version},
              creation = ${JSON.stringify(entity.creation)}, flags = ${JSON.stringify(entity.flags)},
              incarnations = ${written.incarnations},
              suspended_on = ${on}, suspended_cause = ${cause},
              suspended_at = CASE WHEN CAST(${on} AS TEXT) IS NULL THEN NULL WHEN suspended_at IS NULL THEN ${at} ELSE suspended_at END,
              steps = steps + 1
          WHERE name = ${name} AND id = ${id}
        `
      } else {
        yield* sql`
          UPDATE effecttea_entities
          SET incarnations = ${written.incarnations}, suspended_on = ${on}, suspended_cause = ${cause},
              suspended_at = CASE WHEN CAST(${on} AS TEXT) IS NULL THEN NULL WHEN suspended_at IS NULL THEN ${at} ELSE suspended_at END,
              steps = steps + 1
          WHERE name = ${name} AND id = ${id}
        `
      }
      if (written.shown !== null) {
        const projection = JSON.stringify(written.shown.projection)
        characters += projection.length
        yield* row(id, written.shown, projection)
      }
      for (const held of written.keys) {
        yield* upsert('effecttea_entity_keys', ['name', 'id', 'key', 'parameter'], {
          name,
          id,
          ...keyRow(held.key),
          incarnation: held.incarnation,
          version,
          work: JSON.stringify(held.work),
          delivery: held.delivery,
          due: held.due,
        })
      }
      for (const key of written.gone) {
        const { key: held, parameter } = keyRow(key)
        yield* sql`
          DELETE FROM effecttea_entity_keys WHERE name = ${name} AND id = ${id} AND key = ${held} AND parameter = ${parameter}
        `
      }
      // The mailbox's rows are numbered as they are queued: its first message is the lowest.
      if (written.handled > 0) {
        yield* sql`
          DELETE FROM effecttea_mailbox WHERE name = ${name} AND id = ${id} AND seq IN (
            SELECT seq FROM effecttea_mailbox WHERE name = ${name} AND id = ${id} ORDER BY seq LIMIT ${written.handled}
          )
        `
      }
      if (written.queued.length > 0) {
        const last = yield* rows('effecttea_mailbox', Rows.last)(
          sql`SELECT max(seq) AS seq FROM effecttea_mailbox WHERE name = ${name} AND id = ${id}`,
        )
        const first = (last[0]?.seq ?? -1) + 1
        for (const [at, envelope] of written.queued.entries()) {
          yield* sql`INSERT INTO effecttea_mailbox ${
            sql.insert(
              envelope._tag === 'Inbound'
                ? {
                  name,
                  id,
                  seq: first + at,
                  tag: 'Inbound',
                  version,
                  message: JSON.stringify(envelope.message),
                  request: JSON.stringify(envelope.request),
                  keep: envelope.keep,
                  key: null,
                  parameter: null,
                  incarnation: null,
                }
                : {
                  name,
                  id,
                  seq: first + at,
                  tag: 'Internal',
                  version,
                  message: JSON.stringify(envelope.message),
                  request: null,
                  keep: null,
                  ...keyRow(envelope.key),
                  incarnation: envelope.incarnation,
                },
            )
          }`
        }
      }
      // A reply to another entity is kept while the work that asked holds (decision 0021). The work of this
      // entity that ended takes the replies to its requests with it. A reply stored for work of another entity
      // that already ended goes as it is stored, since only the storage sees the asker's keys: an at-most-once
      // operation that delivered `unknown` while its request waited in the mailbox. No machine holds a reply, so
      // none is told (decision 0065). On a pool the asker's step may run at once and miss the row, which `expire`
      // then deletes (decision 0289).
      for (const reply of written.replies) {
        const { asked } = reply
        const asking = asked === null ? null : keyRow(asked.key)
        yield* upsert('effecttea_replies', ['name', 'id', 'request', 'version'], {
          name,
          id,
          request: reply.request,
          request_id: callerOf(reply.request),
          carried: reply.carried === null ? null : JSON.stringify(reply.carried),
          tag: reply.tag,
          version,
          reason: reply.reason === null ? null : JSON.stringify(reply.reason),
          until: reply.until,
          sender_name: asked?.name ?? null,
          sender_id: asked?.id ?? null,
          sender_key: asking?.key ?? null,
          sender_parameter: asking?.parameter ?? null,
          sender_incarnation: asked?.incarnation ?? null,
        })
        if (asked === null || asking === null) continue
        yield* sql`
          DELETE FROM effecttea_replies
          WHERE name = ${name} AND id = ${id} AND request = ${reply.request} AND version = ${version}
            AND NOT EXISTS (
              SELECT 1 FROM effecttea_entity_keys AS asking
              WHERE asking.name = ${asked.name} AND asking.id = ${asked.id} AND asking.key = ${asking.key}
                AND asking.parameter = ${asking.parameter} AND asking.incarnation = ${asked.incarnation}
            )
        `
      }
      for (const { key, incarnation } of written.ended) {
        const ended = keyRow(key)
        yield* sql`
          DELETE FROM effecttea_replies
          WHERE sender_name = ${name} AND sender_id = ${id} AND sender_key = ${ended.key}
            AND sender_parameter = ${ended.parameter} AND sender_incarnation = ${incarnation}
        `
        yield* sql`
          DELETE FROM effecttea_answers
          WHERE sender_name = ${name} AND sender_id = ${id} AND sender_key = ${ended.key}
            AND sender_parameter = ${ended.parameter} AND sender_incarnation = ${incarnation}
        `
      }
      // The step that takes the entity out of its suspension takes its waits with it, before the step's own are
      // written (decision 0265).
      if (written.woken) yield* sql`DELETE FROM effecttea_waiting WHERE name = ${name} AND id = ${id}`
      for (const { asked, name: request } of written.waits) {
        const sending = keyRow(asked.key)
        yield* sql`
          INSERT INTO effecttea_waiting ${
          sql.insert({
            name,
            id,
            sender_name: asked.name,
            sender_id: asked.id,
            sender_key: sending.key,
            sender_parameter: sending.parameter,
            sender_incarnation: asked.incarnation,
            request,
          })
        }
          ON CONFLICT (name, id, sender_name, sender_id, sender_key, sender_parameter, sender_incarnation, request)
          DO NOTHING
        `
      }
      // A step that answers a caller takes its entity's replies past their time with it (decision 0125).
      if (written.replies.length > 0) {
        yield* sql`DELETE FROM effecttea_replies WHERE name = ${name} AND id = ${id} AND until IS NOT NULL AND until <= ${at}`
      }
      // The row of the outbox takes its `step` from the entity's row, which the step wrote first.
      if (outbox && written.published !== null) {
        const { kind, message } = written.published
        const projection = JSON.stringify(written.published.projection)
        characters += projection.length
        yield* sql`
          INSERT INTO effecttea_outbox (name, id, step, kind, version, written_at, message, projection)
          SELECT name, id, steps, ${kind}, version, ${at}, ${message === null ? null : JSON.stringify(message)}, ${projection}
          FROM effecttea_entities WHERE name = ${name} AND id = ${id}
        `
      }
      return characters
    }).pipe(Effect.orDie)

  // Each batch is a transaction of its own, so that a sweep holds SQLite's one writer for a batch at a time
  // (decision 0245). A batch is read in the order of the times, by the
  // index of each table by program and time. A batch locks the rows it selects and skips those a step holds, so that
  // a reply a step wrote again with a new time is read again on the row committed (decision 0285). A batch may then
  // give fewer rows than `batch` with rows left, so the sweep ends at a batch that deletes nothing.
  const expire = (at: number) =>
    Effect.gen(function*() {
      let count = 0
      while (true) {
        const replies = yield* transaction(sql, Effect.gen(function*() {
          const gone = yield* rows('effecttea_replies', Rows.id)(sql`
            DELETE FROM effecttea_replies
            WHERE name = ${name} AND (id, request, version) IN (
              SELECT id, request, version FROM effecttea_replies
              WHERE name = ${name} AND until IS NOT NULL AND until <= ${at}
              ORDER BY until LIMIT ${batch} ${lockingTheConditionSkipping}
            )
            RETURNING id
          `)
          return gone.length
        }))
        count += replies
        if (replies === 0) break
      }
      return count + (yield* ended('effecttea_replies', ['id', 'request', 'version'], Rows.replyKey)) +
        (yield* ended('effecttea_answers', ['id', 'request', 'kind'], Rows.answerKey))
    }).pipe(Effect.orDie)

  // The replies and the answers kept for work that has ended, which the asker's step did not see: on a pool its step
  // and the receiver's run at once, and each reads the other's row only once committed (decision 0289). A work that
  // ended never holds again, so a key absent from what is committed stays absent. The first statement locks a batch
  // and skips the rows a step holds. The second deletes them on the condition read again from its own snapshot, taken
  // once the rows are locked, so that a row whose sender was written again after the first snapshot is read as
  // committed. The sweep ends at a batch that deletes nothing, since a batch whose rows another holds may delete fewer.
  const ended = <K extends Readonly<{ id: string; request: string }>>(
    table: 'effecttea_replies' | 'effecttea_answers',
    keys: ReadonlyArray<string>,
    decode: (held: unknown) => Effect.Effect<ReadonlyArray<K>, Schema.SchemaError>,
  ) =>
    Effect.gen(function*() {
      const gone = sql`NOT EXISTS (
        SELECT 1 FROM effecttea_entity_keys AS asking
        WHERE asking.name = kept.sender_name AND asking.id = kept.sender_id AND asking.key = kept.sender_key
          AND asking.parameter = kept.sender_parameter AND asking.incarnation = kept.sender_incarnation
      )`
      let count = 0
      while (true) {
        const deleted = yield* transaction(sql, Effect.gen(function*() {
          const locked = yield* rows(table, decode)(sql`
            SELECT ${sql.literal(keys.join(', '))} FROM ${sql(table)} AS kept
            WHERE name = ${name} AND sender_name IS NOT NULL AND ${gone}
            ORDER BY ${sql.literal(keys.join(', '))} LIMIT ${batch} ${lockingTheConditionSkipping}
          `)
          if (locked.length === 0) return 0
          const these = sql.or(locked.map((row) =>
            sql.and(keys.map((key) => sql`${sql(key)} = ${(row as Record<string, string | number>)[key]!}`))
          ))
          const removed = yield* sql`
            DELETE FROM ${sql(table)} AS kept WHERE name = ${name} AND (${these}) AND ${gone} RETURNING 1 AS gone
          `
          return removed.length
        }))
        count += deleted
        if (deleted === 0) return count
      }
    })

  /** The entities of the program an operator has to resume: nothing of theirs is handled, and no timer of theirs fires. */
  const onHold = sql`(SELECT id FROM effecttea_entities WHERE name = ${name} AND suspended_on IS NOT NULL)`

  // A key holding an operation has no `due`: the time of a timer is what that column is for.
  const interrupted = Effect.gen(function*() {
      const found = yield* rows('effecttea_entity_keys', Rows.id)(sql`
        SELECT id FROM effecttea_entity_keys
        WHERE name = ${name} AND due IS NULL AND id NOT IN ${onHold}
        UNION
        SELECT id FROM effecttea_mailbox WHERE name = ${name} AND id NOT IN ${onHold}
        ORDER BY id
      `)
      return found.map((row) => row.id)
    }).pipe(Effect.orDie)

  /** One row of a reading through its schema, failed as a page of it would be. */
  const one = <A>(decode: (held: unknown) => Effect.Effect<ReadonlyArray<A>, Schema.SchemaError>, row: unknown) =>
    Effect.map(rows('effecttea_entity_keys', decode)(Effect.succeed([row])), (read) => read[0] as A)
  const due = (now: number) =>
    Effect.gen(function*() {
      const ready: Array<string> = []
      let after = ''
      while (ready.length < batch) {
        const page = yield* rows('effecttea_entity_keys', Rows.id)(sql`
          SELECT DISTINCT id FROM effecttea_entity_keys
          WHERE name = ${name} AND due IS NOT NULL AND due <= ${now}
            AND id > ${after} AND id NOT IN ${onHold}
          ORDER BY id LIMIT ${batch}
        `)
        for (const { id } of page) if (ready.length < batch) ready.push(id)
        if (page.length < batch) break
        after = page[page.length - 1]?.id ?? after
      }
      // The earliest time of an entity, read in the order of the times. A row whose time
      // is refused is its entity's alone: the entity is given back with the reason, and the reading goes on to the
      // next row, so that one row an operator wrote by hand stops no other entity's timer (decision 0259).
      let next: number | null = null
      const refused: Array<{ id: string; reason: string }> = []
      let from: Readonly<{ at: number | string | bigint; id: string }> | null = null
      while (next === null) {
        const page: ReadonlyArray<Readonly<{ id: unknown; at: number | string | bigint }>> = yield* sql<
          Readonly<{ id: unknown; at: number | string | bigint }>
        >`
          SELECT id, MIN(due) AS at FROM effecttea_entity_keys
          WHERE name = ${name} AND due > ${now} AND id NOT IN ${onHold}
          GROUP BY id
          ${from === null ? sql`` : sql`HAVING MIN(due) > ${from.at} OR (MIN(due) = ${from.at} AND id > ${from.id})`}
          ORDER BY at, id LIMIT ${batch}
        `
        let last: string | null = null
        for (const row of page) {
          const { id }: { id: string } = yield* one(Rows.id, row)
          last = id
          const read = yield* Effect.result(one(Rows.due, row))
          if (Result.isFailure(read)) refused.push({ id, reason: read.failure.message })
          else {
            next = read.success.at
            break
          }
        }
        const end = page[page.length - 1]
        if (next !== null || page.length < batch || end === undefined || last === null) break
        from = { at: end.at, id: last }
      }
      return { ready, next, refused } satisfies Due
    }).pipe(Effect.orDie)

  // The tag of the mailbox's first message says what a `Message` the entity died on is: an inbound one is
  // discarded, an internal one is not (decisions 0041, 0044, 0114).
  const listedAs = (
    id: string,
    on: Machine.Suspension['on'],
    head: 'Inbound' | 'Internal' | null,
    cause: string,
    at: number,
  ): Effect.Effect<Suspension> =>
    on._tag === 'Message' && head === null
      ? Effect.die(new Error(`the entity '${name}' '${id}' is suspended on a message, and its mailbox is empty`))
      : Effect.succeed({
        id,
        on: on._tag === 'Message' ? { _tag: 'Message', kind: head ?? 'Inbound' } : on,
        cause,
        since: DateTime.makeUnsafe(at),
      })

  // A wait is listed while the run that sent holds: a row whose run ended or was restarted under another
  // incarnation is left out, and goes when the entity is taken out of its suspension (decision 0265).
  const waitingOf = (id: string | null) =>
    Effect.map(
      rows('effecttea_waiting', Rows.waiting)(sql`
        SELECT w.id, w.sender_name, w.sender_id, w.sender_key, w.sender_parameter, w.sender_incarnation, w.request
        FROM effecttea_waiting AS w JOIN effecttea_entity_keys AS k
          ON k.name = w.sender_name AND k.id = w.sender_id AND k.key = w.sender_key
            AND k.parameter = w.sender_parameter AND k.incarnation = w.sender_incarnation
        WHERE ${sql.and([sql`w.name = ${name}`, ...(id === null ? [] : [sql`w.id = ${id}`])])}
        ORDER BY w.id, w.sender_name, w.sender_id, w.sender_key, w.sender_parameter, w.sender_incarnation, w.request
      `),
      (held) => {
        const waiting = new Map<string, Array<Waiting>>()
        for (const row of held) {
          const listed = waiting.get(row.id) ?? []
          listed.push({
            entity: { name: row.sender_name, id: row.sender_id },
            key: keyOfRow(row.sender_key, row.sender_parameter),
            incarnation: row.sender_incarnation,
            name: row.request,
          })
          waiting.set(row.id, listed)
        }
        return waiting
      },
    )

  const suspensions = snapshot(Effect.gen(function*() {
    const waiting = yield* waitingOf(null)
    const held = yield* rows('effecttea_entities', Rows.suspended)(sql`
      SELECT id, suspended_on, suspended_cause, suspended_at, (
        SELECT tag FROM effecttea_mailbox WHERE effecttea_mailbox.name = effecttea_entities.name AND effecttea_mailbox.id = effecttea_entities.id ORDER BY seq LIMIT 1
      ) AS head
      FROM effecttea_entities WHERE name = ${name} AND suspended_on IS NOT NULL ORDER BY suspended_at, id
    `)
    const listed: Array<Suspended> = []
    for (const row of held) {
      const suspension = yield* listedAs(
        row.id,
        suspended.read(row.suspended_on),
        row.head,
        row.suspended_cause,
        row.suspended_at,
      )
      listed.push({ ...suspension, waiting: waiting.get(row.id) ?? [] })
    }
    return listed
  })).pipe(Effect.orDie)

  return {
    lock,
    load,
    reply,
    answer,
    keepAnswer,
    write,
    interrupted,
    due,
    expire,
    suspended: suspensions,
    inspect,
    examine,
    entities,
  }
}
