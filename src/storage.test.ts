/**
 * The storage writes what the machine says an event writes, and decides nothing but what only it sees: another
 * entity's keys (decision 0057). Here it is given rows by hand, and what it holds afterwards is read back.
 */
import { SqliteClient } from '@effect/sql-sqlite-bun'
import { describe, expect, test } from 'bun:test'
import * as Cause from 'effect/Cause'
import * as DateTime from 'effect/DateTime'
import * as Effect from 'effect/Effect'
import * as Exit from 'effect/Exit'
import * as Schema from 'effect/Schema'
import { SqlClient, Statement } from 'effect/sql'
import * as Machine from './machine.ts'
import {
  InvariantDefect,
  isTimer,
  type Json,
  keyedBytes,
  type Migration,
  noWork,
  operation,
  type Program,
  requestBytes,
  type Scalar,
} from './program.ts'
import {
  batch,
  type Comparison,
  createTables,
  type Criterion,
  type Dialect,
  dialectOf,
  type Found,
  migrate,
  type Query,
  storage,
  tablesMade,
} from './storage.ts'
import { client, onEach } from './storage.test_databases.ts'
import fc from 'fast-check'

type T = {
  state: Readonly<{ last: string }>
  flags: null
  inbound: string
  internal: string
  operation: Readonly<{ _tag: 'Ask' }>
  key: 'ask'
  parameter: {}
  rejection: never
  sender: null
  projection: string
  index: never
  services: never
}

const named = (name: string): Program<T> => ({
  name,
  keys: { ask: null },
  schemas: {
    state: Schema.Struct({ last: Schema.String }),
    flags: Schema.Null,
    inbound: Schema.String,
    internal: Schema.String,
    operation: Schema.TaggedStruct('Ask', {}),
    rejection: Schema.Never,
    sender: Schema.Null,
    projection: Schema.String,
  },
  init: () => ({ last: 'start' }),
  update: (message) => () => ({ last: message }),
  work: () => noWork,
  operations: { Ask: operation(() => Effect.succeed('asked')) },
  project: ({ last }) => last,
  indexes: {},
})

const asker = named('Asker')
const receiver = named('Receiver')

/** What an event that writes nothing but `rows` gives the storage. */
const written = (rows: Partial<Machine.Written>): Machine.Written => ({
  created: false,
  entity: null,
  suspension: null,
  keys: [],
  gone: [],
  incarnations: 0,
  handled: 0,
  queued: [],
  replies: [],
  ended: [],
  waits: [],
  woken: false,
  shown: null,
  published: null,
  ...rows,
})

/** The first rows of an entity, as a creation writes them. */
const created = (rows: Partial<Machine.Written> = {}): Machine.Written =>
  written({
    created: true,
    entity: { state: { last: 'start' }, creation, flags: null },
    shown: { projection: 'start', indexes: {} },
    ...rows,
  })

/** A caller's request that created the entity, as the machine encodes it. */
const creation = { _tag: 'Caller', sender: null, id: 'creation' } as const
/** A limit no reading of these tests reaches: a reading says how many rows it takes (decision 0141). */
const all = 1_000

/** The request named `name` of the asker's work in `incarnation`, as the machine keys its reply (decision 0059). */
const asked = (name: string, incarnation: number) =>
  ({ _tag: 'Operation', entity: { name: 'Asker', id: 'a' }, key: { name: 'ask' }, incarnation, name }) as const

const sent = (name: string, incarnation: number) => Machine.requestKey(receiver, asked(name, incarnation))

const reply = (name: string, incarnation: number): Machine.ReplyRow => ({
  request: sent(name, incarnation),
  carried: null,
  tag: 'Accepted',
  reason: null,
  asked: { name: 'Asker', id: 'a', key: { name: 'ask' }, incarnation },
  until: null,
})

const inbound = (message: string): Machine.EnvelopeRow => ({
  _tag: 'Inbound',
  message,
  request: { _tag: 'Caller', sender: null, id: message },
  keep: null,
})

/**
 * Runs `body` on a database of each of `dialects` whose tables are created, one after the other. A failure names the
 * dialect it failed on. The storage speaks both dialects, so a test runs on both unless it reads what only one
 * writes (decision 0157).
 */
const database = <A>(
  body: (sql: SqlClient.SqlClient) => Effect.Effect<A>,
  dialects: ReadonlyArray<Dialect> = ['sqlite', 'pg'],
) =>
  onEach(dialects, (dialect) =>
    Effect.runPromise(
      Effect.flatMap(createTables, () => Effect.flatMap(SqlClient.SqlClient, body)).pipe(
        Effect.provide(client(dialect)),
        Effect.orDie,
      ),
    ))

test('a reply asked by work that no longer holds goes as it is stored, and one whose work holds is kept', () =>
  database((sql) =>
    Effect.gen(function*() {
      // The asker holds its work in its first incarnation: the second one has ended.
      const work = { _tag: 'Operation', operation: { _tag: 'Ask' } }
      yield* storage(asker, sql).write(
        'a',
        created({ keys: [{ key: { name: 'ask' }, incarnation: 1, work, delivery: 'Idempotent', due: null }] }),
        0,
      )
      const store = storage(receiver, sql)
      yield* store.write('r', created({ replies: [reply('held', 1), reply('ended', 2)] }), 0)
      expect((yield* store.reply('r', asked('held', 1), 0))?.reply ?? null).toEqual({ _tag: 'Accepted' })
      expect((yield* store.reply('r', asked('ended', 2), 0))?.reply ?? null).toBeNull()
    })))

// An answer no entity stores is kept by the rule of a reply: it goes as it is kept where the work that asked has
// ended, and a creation's answer and a message's under one name keep a row each (decision 0253).
test('an answer kept for work that no longer holds goes as it is kept, and a creation’s and a message’s are apart', () =>
  database((sql) =>
    Effect.gen(function*() {
      // The asker holds its work in its first incarnation: the second one has ended.
      const work = { _tag: 'Operation', operation: { _tag: 'Ask' } }
      yield* storage(asker, sql).write(
        'a',
        created({ keys: [{ key: { name: 'ask' }, incarnation: 1, work, delivery: 'Idempotent', due: null }] }),
        0,
      )
      const store = storage(receiver, sql)
      yield* store.keepAnswer('r', 'Message', asked('held', 1), { _tag: 'NotFound' })
      yield* store.keepAnswer('r', 'Create', asked('held', 1), { _tag: 'Rejected', reason: null })
      yield* store.keepAnswer('r', 'Message', asked('ended', 2), { _tag: 'NotFound' })
      expect(yield* store.answer('r', 'Message', asked('held', 1))).toEqual({ _tag: 'NotFound' })
      expect(yield* store.answer('r', 'Create', asked('held', 1))).toEqual({ _tag: 'Rejected', reason: null })
      expect(yield* store.answer('r', 'Message', asked('ended', 2))).toBeNull()
    })))

// A reply or an answer whose asker's step did not see it outlives its work, as two steps at once on a pool leave it.
// The test takes the asker's key out by hand, as that step does without deleting the reply, and renews it to a
// later incarnation, as a step that starts the work again does. `expire` deletes what the ended work was given, more
// rows than a batch, and keeps what the work that holds was given (decision 0289).
test('expire deletes the replies and the answers kept for work that has ended, and keeps those of work that holds', () =>
  database((sql) =>
    Effect.gen(function*() {
      const work = { _tag: 'Operation', operation: { _tag: 'Ask' } }
      const key: Machine.KeyRow = { key: { name: 'ask' }, incarnation: 1, work, delivery: 'Idempotent', due: null }
      yield* storage(asker, sql).write('a', created({ keys: [key] }), 0)
      const store = storage(receiver, sql)
      const held = Array.from({ length: 300 }, (_, at) => reply(`held-${at}`, 1))
      yield* store.write('q', created({ replies: held }), 0)
      yield* store.write('r', created({ replies: [reply('renewed', 1)] }), 0)
      yield* store.keepAnswer('r', 'Message', asked('renewed', 1), { _tag: 'NotFound' })
      yield* store.keepAnswer('r', 'Create', asked('held', 1), { _tag: 'NotFound' })
      expect(yield* store.expire(0)).toBe(0)
      // The work starts again in its second incarnation: what the first was given goes.
      yield* sql`UPDATE effecttea_entity_keys SET incarnation = 2 WHERE name = 'Asker' AND id = 'a'`
      yield* store.write('s', created({ replies: [reply('again', 2)] }), 0)
      yield* store.keepAnswer('s', 'Message', asked('again', 2), { _tag: 'NotFound' })
      expect(yield* store.expire(0)).toBe(300 + 1 + 2)
      expect((yield* store.reply('s', asked('again', 2), 0))?.reply ?? null).toEqual({ _tag: 'Accepted' })
      expect(yield* store.answer('s', 'Message', asked('again', 2))).toEqual({ _tag: 'NotFound' })
      // The work ends: its key is gone, and so is what it was given.
      yield* sql`DELETE FROM effecttea_entity_keys WHERE name = 'Asker' AND id = 'a'`
      expect(yield* store.expire(0)).toBe(2)
      expect(yield* sql`SELECT id FROM effecttea_replies`).toEqual([])
      expect(yield* sql`SELECT id FROM effecttea_answers`).toEqual([])
    }).pipe(Effect.orDie)))

// A key without a parameter has none, which no parameter's JSON is: its row and its parameter's never meet
// (decision 0136).
test('a key is stored as its name and its parameter, apart from a key of the same name without one', () =>
  database((sql) =>
    Effect.gen(function*() {
      const work = { _tag: 'Operation', operation: { _tag: 'Ask' } }
      const row = (key: Machine.KeyRow['key'], incarnation: number): Machine.KeyRow =>
        ({ key, incarnation, work, delivery: 'Idempotent', due: null })
      const plain = { name: 'ask' }
      const empty = { name: 'ask', parameter: '' }
      const nothing = { name: 'ask', parameter: null }
      const record = { name: 'ask', parameter: { a: 1, b: [2] } }
      const suspension = { on: { _tag: 'Operation', key: record, incarnation: 4 }, cause: 'died' } as const
      const store = storage(asker, sql)
      yield* store.write('a', created({
        keys: [row(plain, 1), row(empty, 2), row(nothing, 3), row(record, 4)],
        queued: [{ _tag: 'Internal', message: 'done', key: empty, incarnation: 2 }],
        incarnations: 4,
        suspension,
      }), 0)
      const loaded = yield* store.load('a')
      expect(Object.values(loaded?.keys ?? {}).map(({ key, incarnation }) => ({ key, incarnation }))).toEqual([
        { key: plain, incarnation: 1 },
        { key: empty, incarnation: 2 },
        { key: nothing, incarnation: 3 },
        { key: record, incarnation: 4 },
      ])
      expect(loaded?.mailbox).toEqual([{ _tag: 'Internal', message: 'done', key: empty, incarnation: 2 }])
      expect(loaded?.suspension?.on).toEqual(suspension.on)
      // A reply kept for the work under one of them goes with that work alone.
      const receiving = storage(receiver, sql)
      const asking = (key: Machine.KeyRow['key'], incarnation: number) =>
        ({ _tag: 'Operation', entity: { name: 'Asker', id: 'a' }, key, incarnation, name: 'n' }) as const
      const kept = (key: Machine.KeyRow['key'], incarnation: number): Machine.ReplyRow => ({
        request: Machine.requestKey(receiver, asking(key, incarnation)),
        carried: null,
        tag: 'Accepted',
        reason: null,
        asked: { name: 'Asker', id: 'a', key, incarnation },
        until: null,
      })
      yield* receiving.write('r', created({ replies: [kept(plain, 1), kept(empty, 2), kept(record, 4)] }), 0)
      yield* store.write('a', written({ gone: [empty], incarnations: 4, ended: [{ key: empty, incarnation: 2 }] }), 0)
      expect((yield* receiving.reply('r', asking(plain, 1), 0))?.reply ?? null).toEqual({ _tag: 'Accepted' })
      expect((yield* receiving.reply('r', asking(empty, 2), 0))?.reply ?? null).toBeNull()
      expect((yield* receiving.reply('r', asking(record, 4), 0))?.reply ?? null).toEqual({ _tag: 'Accepted' })
      const after = yield* store.load('a')
      expect(Object.values(after?.keys ?? {}).map(({ key }) => key)).toEqual([plain, nothing, record])
    })))

test('an operation given the digest of its idempotency key is loaded as delivered so (decision 0123)', () =>
  database((sql) =>
    Effect.gen(function*() {
      const work = { _tag: 'Operation', operation: { _tag: 'Ask' } }
      const store = storage(asker, sql)
      yield* store.write(
        'a',
        created({ keys: [{ key: { name: 'ask' }, incarnation: 1, work, delivery: 'IdempotentDigest', due: null }] }),
        0,
      )
      expect((yield* store.load('a'))?.keys[Machine.keyText({ name: 'ask' })]?.delivery).toBe('IdempotentDigest')
    })))

test('the work that ended takes the replies to its requests with it, and no others', () =>
  database((sql) =>
    Effect.gen(function*() {
      const work = { _tag: 'Operation', operation: { _tag: 'Ask' } }
      yield* storage(asker, sql).write(
        'a',
        created({ keys: [{ key: { name: 'ask' }, incarnation: 1, work, delivery: 'Idempotent', due: null }], incarnations: 1 }),
        0,
      )
      const store = storage(receiver, sql)
      yield* store.write('r', created({ replies: [reply('first', 1)] }), 0)
      yield* store.write('s', created({ replies: [reply('other', 1)] }), 0)
      // Work of another incarnation asked nothing that is stored.
      yield* storage(asker, sql).write('a', written({ ended: [{ key: { name: 'ask' }, incarnation: 2 }] }), 0)
      expect((yield* store.reply('r', asked('first', 1), 0))?.reply ?? null).toEqual({ _tag: 'Accepted' })
      yield* storage(asker, sql).write(
        'a',
        written({ gone: [{ name: 'ask' }], incarnations: 1, ended: [{ key: { name: 'ask' }, incarnation: 1 }] }),
        0,
      )
      expect((yield* store.reply('r', asked('first', 1), 0))?.reply ?? null).toBeNull()
      expect((yield* store.reply('s', asked('other', 1), 0))?.reply ?? null).toBeNull()
      // A key whose work is gone has no row, and the entity keeps the last incarnation it drew (decision 0132).
      const loaded = yield* storage(asker, sql).load('a')
      expect(loaded?.keys).toEqual({})
      expect(loaded?.incarnations).toBe(1)
    })))

test('a reply is read by its request alone, and a caller is given its own', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(receiver, sql)
      const caller = (id: string) => ({ _tag: 'Caller', sender: null, id }) as const
      const accepted = (id: string): Machine.ReplyRow => ({
        request: Machine.requestKey(receiver, caller(id)),
        carried: null,
        tag: 'Accepted',
        reason: null,
        asked: null,
        until: null,
      })
      yield* store.write('r', created({ replies: [accepted('one')] }), 0)
      expect((yield* store.reply('r', caller('one'), 0))?.reply ?? null).toEqual({ _tag: 'Accepted' })
      expect((yield* store.reply('r', caller('two'), 0))?.reply ?? null).toBeNull()
      expect((yield* store.reply('s', caller('one'), 0))?.reply ?? null).toBeNull()
      // An operation's request named as the caller's request id is another request.
      expect((yield* store.reply('r', asked('one', 1), 0))?.reply ?? null).toBeNull()
    })))

describe('how long a caller’s reply is kept (decision 0125)', () => {
  const caller = (id: string) => ({ _tag: 'Caller', sender: null, id }) as const
  const until = (id: string, time: number | null): Machine.ReplyRow => ({
    request: Machine.requestKey(receiver, caller(id)),
    carried: null,
    tag: 'Accepted',
    reason: null,
    asked: null,
    until: time,
  })

  test('a reply is read before its time only, whether its row is deleted yet or not', () =>
    database((sql) =>
      Effect.gen(function*() {
        const store = storage(receiver, sql)
        yield* store.write('r', created({ replies: [until('kept', 500), until('forever', null)] }), 0)
        expect((yield* store.reply('r', caller('kept'), 499))?.reply ?? null).toEqual({ _tag: 'Accepted' })
        expect((yield* store.reply('r', caller('kept'), 500))?.reply ?? null).toBeNull()
        expect((yield* store.reply('r', caller('forever'), Number.MAX_SAFE_INTEGER))?.reply ?? null).toEqual({ _tag: 'Accepted' })
      })))

  test('a reply a version before stored is read before its time only, as one this version stored', () =>
    database((sql) =>
      Effect.gen(function*() {
        type Named = Omit<T, 'sender'> & { sender: string }
        const callers = (migrations: ReadonlyArray<Migration>): Program<Named> => ({
          ...receiver,
          schemas: { ...receiver.schemas, sender: Schema.String },
          update: (message) => () => ({ last: message }),
          migrations,
        })
        const first = callers([])
        const by = (sender: string) => ({ _tag: 'Caller', sender, id: 'r' }) as const
        yield* storage(first, sql).write('r', created({
          replies: [{ request: Machine.requestKey(first, by('a')), carried: null, tag: 'Accepted', reason: null, asked: null, until: 500 }],
        }), 0)
        // Version 2 renames the sender 'a' to 'b', so its retry is found by its request id (decision 0065).
        const after = storage(callers([{ sender: (json) => json === 'a' ? 'b' : json }]), sql)
        expect((yield* after.reply('r', by('b'), 499))?.reply ?? null).toEqual({ _tag: 'Accepted' })
        expect((yield* after.reply('r', by('b'), 500))?.reply ?? null).toBeNull()
      })))

  test('a step that stores a reply deletes the replies of its entity past their time, and no others', () =>
    database((sql) =>
      Effect.gen(function*() {
        const store = storage(receiver, sql)
        yield* store.write('r', created({ replies: [until('gone', 500), until('kept', 900)] }), 0)
        yield* store.write('s', created({ replies: [until('other', 500)] }), 0)
        // A step that stores no reply deletes nothing.
        yield* store.write('r', written({ shown: { projection: 'start', indexes: {} } }), 600)
        const left = () => sql<{ id: string; request: string }>`SELECT id, request FROM effecttea_replies ORDER BY id, request`
        expect((yield* left()).length).toBe(3)
        yield* store.write('r', written({ replies: [until('new', 1_600)] }), 600)
        expect((yield* left()).map(({ id, request }) => [id, JSON.parse(request).id])).toEqual([
          ['r', 'kept'],
          ['r', 'new'],
          ['s', 'other'],
        ])
      }).pipe(Effect.orDie)))

  test('expire deletes the replies of the program past their time, counts them, and leaves the rest', () =>
    database((sql) =>
      Effect.gen(function*() {
        const store = storage(receiver, sql)
        yield* store.write('r', created({ replies: [until('gone', 500), until('kept', 900), until('ever', null)] }), 0)
        yield* store.write('s', created({ replies: [until('gone', 500)] }), 0)
        yield* storage(asker, sql).write('a', created({ replies: [until('gone', 500)] }), 0)
        expect(yield* store.expire(600)).toBe(2)
        expect((yield* store.reply('r', caller('kept'), 600))?.reply ?? null).toEqual({ _tag: 'Accepted' })
        expect((yield* store.reply('r', caller('ever'), 600))?.reply ?? null).toEqual({ _tag: 'Accepted' })
        expect(yield* storage(asker, sql).expire(0)).toBe(0)
        expect(yield* storage(asker, sql).expire(600)).toBe(1)
      })))

  // A batch is a transaction of its own, and the count is the sum of the batches (decision 0245).
  test('expire deletes past a batch, and counts every row', () =>
    database((sql) =>
      Effect.gen(function*() {
        const store = storage(receiver, sql)
        const many = Array.from({ length: 2 * batch + 1 }, (_, i) => until(`gone ${i}`, 500))
        yield* store.write('r', created({ replies: [...many, until('kept', 900)] }), 0)
        expect(yield* store.expire(600)).toBe(2 * batch + 1)
        expect((yield* store.reply('r', caller('kept'), 600))?.reply ?? null).toEqual({ _tag: 'Accepted' })
        const left = (table: string) =>
          Effect.map(sql<{ count: number }>`SELECT count(*) AS count FROM ${sql(table)}`, (rows) => Number(rows[0]?.count))
        expect(yield* left('effecttea_replies')).toBe(1)
        expect(yield* store.expire(600)).toBe(0)
      }).pipe(Effect.orDie), ['sqlite']))

  test('a message in the mailbox is loaded with the keep it was queued with', () =>
    database((sql) =>
      Effect.gen(function*() {
        const store = storage(receiver, sql)
        const kept: Machine.EnvelopeRow = { _tag: 'Inbound', message: 'kept', request: caller('kept'), keep: 500 }
        yield* store.write('r', created({ queued: [kept, inbound('forever')] }), 0)
        const mailbox = (yield* store.load('r'))?.mailbox ?? []
        expect(mailbox.map((envelope) => envelope._tag === 'Inbound' ? envelope.keep : null))
          .toEqual([500, undefined])
      })))
})

// A process starts what holds an operation or a message, unless an operator has to resume it first (decisions
// 0006, 0029, 0071).
test('a process starts the entities holding an operation or a message, and none of them suspended', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(receiver, sql)
      const keys = [{
        key: { name: 'ask' },
        incarnation: 1,
        work: { _tag: 'Operation', operation: { _tag: 'Ask' } },
        delivery: 'Idempotent',
        due: null,
      }] as const
      const queued = [inbound('one')]
      const suspension = { on: { _tag: 'Message' }, cause: 'broken' } as const
      yield* store.write('operation', created({ keys }), 0)
      yield* store.write('message', created({ queued }), 0)
      yield* store.write('both', created({ keys, queued }), 0)
      yield* store.write('idle', created(), 0)
      yield* store.write('suspended operation', created({ keys, suspension }), 0)
      yield* store.write('suspended message', created({ queued, suspension }), 0)
      expect(yield* store.interrupted).toEqual(['both', 'message', 'operation'])
    })))

test('the mailbox keeps the order its messages were queued in, as its head is handled', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(receiver, sql)
      yield* store.write('r', created({ queued: [inbound('one'), inbound('two')] }), 0)
      yield* store.write('r', written({ handled: 1, queued: [inbound('three')] }), 0)
      yield* store.write('r', written({ queued: [inbound('four')] }), 0)
      yield* store.write('r', written({ handled: 1 }), 0)
      const mailbox = (yield* store.load('r'))?.mailbox ?? []
      expect(mailbox.map((envelope) => envelope.message)).toEqual(['three', 'four'])
    })))

test('the state is written with the request that created the entity, and only when an event changed it', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(receiver, sql)
      yield* store.write('r', created(), 0)
      yield* store.write('r', written({ suspension: { on: { _tag: 'Message' }, cause: 'broken' } }), 0)
      expect(yield* store.load('r')).toMatchObject({
        state: { last: 'start' },
        suspension: { on: { _tag: 'Message' }, cause: 'broken' },
      })
      yield* store.write('r', written({ entity: { state: { last: 'next' }, creation, flags: null } }), 0)
      expect(yield* store.load('r')).toMatchObject({
        state: { last: 'next' },
        creation,
        suspension: null,
      })
    })))

// A row is read through its table's schema, and nothing is filled in or cast (decision 0062).
test('a row the runtime never writes fails the call that meets it, and is read as nothing else', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(receiver, sql)
      yield* store.write('r', created({ queued: [inbound('one')] }), 0)
      const caller = { _tag: 'Caller', sender: null, id: 'x' } as const
      const broken = [
        [sql`UPDATE effecttea_mailbox SET tag = 'Outbound' WHERE name = 'Receiver' AND id = 'r'`, store.load('r')],
        [sql`UPDATE effecttea_mailbox SET request = NULL WHERE name = 'Receiver' AND id = 'r'`, store.load('r')],
        [
          sql`UPDATE effecttea_entities SET suspended_on = '{"_tag":"Message"}' WHERE name = 'Receiver' AND id = 'r'`,
          store.load('r'),
        ],
        [
          sql`INSERT INTO effecttea_replies ${
            sql.insert({
              name: 'Receiver',
              id: 'r',
              request: Machine.requestKey(receiver, caller),
              carried: null,
              tag: 'Maybe',
              version: 1,
              reason: null,
            })
          }`,
          store.reply('r', caller, 0),
        ],
        // The columns that go together: an inbound message has no key, an internal one no request, and only a
        // rejection a reason.
        [
          sql`INSERT INTO effecttea_entity_keys ${
            sql.insert({
              name: 'Receiver',
              id: 'r',
              key: 'ask',
              parameter: '',
              incarnation: 1,
              version: 1,
              work: '{"_tag":"Operation","operation":{"_tag":"Ask"}}',
              delivery: 'Twice',
            })
          }`,
          store.load('r'),
        ],
        [sql`UPDATE effecttea_mailbox SET key = 'ask' WHERE name = 'Receiver' AND id = 'r'`, store.load('r')],
        [
          sql`UPDATE effecttea_mailbox SET tag = 'Outbound', request = NULL, key = 'ask', incarnation = 1
              WHERE name = 'Receiver' AND id = 'r'`,
          store.load('r'),
        ],
        [
          sql`UPDATE effecttea_mailbox SET tag = 'Internal', key = 'ask', incarnation = 1 WHERE name = 'Receiver' AND id = 'r'`,
          store.load('r'),
        ],
        [
          sql`INSERT INTO effecttea_replies ${
            sql.insert({
              name: 'Receiver',
              id: 'r',
              request: Machine.requestKey(receiver, caller),
              carried: null,
              tag: 'Accepted',
              version: 1,
              reason: '"why"',
            })
          }`,
          store.reply('r', caller, 0),
        ],
        // A version from 1, and a count from 0, wherever they are read.
        [sql`UPDATE effecttea_entities SET version = 0 WHERE name = 'Receiver' AND id = 'r'`, store.load('r')],
        [sql`UPDATE effecttea_entities SET version = 0 WHERE name = 'Receiver' AND id = 'r'`, store.reindex],
        [sql`UPDATE effecttea_projections SET version = 0 WHERE name = 'Receiver' AND id = 'r'`, store.query({ limit: all })],
        [
          sql`INSERT INTO effecttea_entity_keys ${
            sql.insert({
              name: 'Receiver',
              id: 'r',
              key: 'ask',
              parameter: '',
              incarnation: -1,
              version: 1,
              work: '{"_tag":"Operation","operation":{"_tag":"Ask"}}',
              delivery: 'Idempotent',
            })
          }`,
          store.load('r'),
        ],
        [sql`UPDATE effecttea_entities SET incarnations = -1 WHERE name = 'Receiver' AND id = 'r'`, store.load('r')],
        [
          sql`UPDATE effecttea_mailbox SET seq = -5 WHERE name = 'Receiver' AND id = 'r'`,
          store.write('r', written({ queued: [inbound('two')] }), 0),
        ],
      ] as const
      for (const [index, [breaking, reading]] of broken.entries()) {
        // Broken and read in a transaction that fails with what the reading gave, so that nothing of it stays.
        const exit = yield* Effect.flip(sql.withTransaction(
          Effect.andThen(breaking, Effect.flatMap(Effect.exit<unknown, never, never>(reading), Effect.fail)),
        ))
        // PostgreSQL refuses by the types of its columns some rows SQLite holds, such as a time that is no number.
        if (!Exit.isExit(exit) && dialectOf(sql) === 'pg') continue
        expect([index, Exit.isExit(exit) && exit._tag]).toEqual([index, 'Failure'])
        if (Exit.isExit(exit) && exit._tag === 'Failure') {
          expect(String(Cause.squash(exit.cause))).toContain('no row the runtime writes')
        }
      }
      expect((yield* store.load('r'))?.mailbox.map((envelope) => envelope.message)).toEqual(['one'])
    }).pipe(Effect.orDie)))

// The waker reads a timer's time as an integer of milliseconds within 2^53. A time an operator writes by hand that
// the waker would not read would stop its entity's timers, so the table refuses it as it is written.
test('the table refuses a timer’s time the waker would not read, on both dialects', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(receiver, sql)
      const row = (due: unknown) =>
        sql`INSERT INTO effecttea_entity_keys ${
          sql.insert({
            name: 'Receiver',
            id: 'r',
            key: 'ring',
            parameter: '',
            incarnation: 1,
            version: 1,
            work: '{"_tag":"Timer","at":1,"message":"rang"}',
            delivery: null,
            due: due as never,
          })
        }`
      // Each row is written in a transaction rolled back, so that one taken leaves no row under the key.
      const taken = (due: unknown) =>
        Effect.map(Effect.flip(sql.withTransaction(Effect.andThen(row(due), Effect.fail('taken' as const)))), (end) =>
          end === 'taken')
      // A server of PostgreSQL rounds a double given a column of integers, where PGlite refuses it, and the waker
      // reads the integer. So a time that is no integer is written on SQLite alone.
      const times = [
        'soon',
        BigInt(Number.MAX_SAFE_INTEGER) + 1n,
        -BigInt(Number.MAX_SAFE_INTEGER) - 1n,
        ...(dialectOf(sql) === 'sqlite' ? [1.5] : []),
      ]
      const refused: Array<unknown> = []
      for (const due of times) if (!(yield* taken(due))) refused.push(due)
      expect(refused).toEqual(times)
      yield* row(Number.MAX_SAFE_INTEGER)
      expect((yield* store.due(0)).next).toBe(Number.MAX_SAFE_INTEGER)
    }).pipe(Effect.orDie)))

// A row is keyed by its request as the version that wrote it encoded it, and by that version (decision 0069).
test('a caller whose request a migration gives the text of another caller’s row takes nothing of it', () =>
  database((sql) =>
    Effect.gen(function*() {
      type Named = Omit<T, 'sender'> & { sender: string }
      const callers = (migrations: ReadonlyArray<Migration>): Program<Named> => ({
        ...receiver,
        schemas: { ...receiver.schemas, sender: Schema.String },
        update: (message) => () => ({ last: message }),
        migrations,
      })
      const first = callers([])
      // Version 2 renames the sender 'a' to 'b', and gives 'a' to the one that was 'z'.
      const second = callers([{ sender: (json) => json === 'a' ? 'b' : json === 'z' ? 'a' : json }])
      const caller = (sender: string) => ({ _tag: 'Caller', sender, id: 'r' }) as const
      const accepted = (program: Program<Named>, sender: string): Machine.ReplyRow => ({
        request: Machine.requestKey(program, caller(sender)),
        carried: null,
        tag: 'Accepted',
        reason: null,
        asked: null,
        until: null,
      })
      yield* storage(first, sql).write('r', created({ replies: [accepted(first, 'a')] }), 0)
      const after = storage(second, sql)
      // The caller that is 'a' in version 2 has the text of the row of 'a' in version 1, and is not answered by it.
      expect((yield* after.reply('r', caller('a'), 0))?.reply ?? null).toBeNull()
      yield* after.write('r', written({ replies: [accepted(second, 'a')] }), 0)
      expect((yield* after.reply('r', caller('a'), 0))?.reply ?? null).toEqual({ _tag: 'Accepted' })
      // The caller version 1 stored as 'a' is 'b' now, and its retry still finds its own reply.
      expect((yield* after.reply('r', caller('b'), 0))?.reply ?? null).toEqual({ _tag: 'Accepted' })
    })))

// A message costs a reading by the table's key, and a caller's that finds nothing one more, by its request id: each
// by an index, as the storage writes them (decision 0065).
test('a reply is read by the key of its table, and a caller’s again by an index of its request id', () =>
  database((sql) =>
    Effect.gen(function*() {
      const plan = (query: string) =>
        Effect.map(sql.unsafe<{ detail: string }>(`EXPLAIN QUERY PLAN ${query}`), (rows) =>
          rows.map(({ detail }) => detail).join(' '))
      expect(
        yield* plan(`SELECT request, tag, version, reason FROM effecttea_replies
                     WHERE name = 'Receiver' AND id = 'r' AND request = '{}'`),
      ).toContain('USING INDEX sqlite_autoindex_effecttea_replies_1 (name=? AND id=? AND request=?)')
      expect(
        yield* plan(`SELECT request, tag, version, reason FROM effecttea_replies
                     WHERE name = 'Receiver' AND id = 'r' AND request_id = 'x' AND version <> 2`),
      ).toContain('USING INDEX effecttea_replies_by_request_id (name=? AND id=? AND request_id=?)')
    }).pipe(Effect.orDie), ['sqlite']))

// The tables of an application may sit in the runtime's database, so every object the runtime makes is named with
// `effecttea_`, SQLite's own excepted (decision 0218).
test('every table, index, trigger and function the runtime makes is named with effecttea_', () =>
  database((sql) =>
    Effect.gen(function*() {
      yield* storage(ranked, sql).indexed
      yield* storage(receiver, sql).write('r', created(), 0)
      const names = dialectOf(sql) === 'sqlite'
        ? yield* sql<{ name: string }>`
          SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_autoindex_effecttea_%' AND name <> 'sqlite_sequence'
        `
        : yield* sql<{ name: string }>`
          SELECT relname AS name FROM pg_class WHERE relnamespace = current_schema()::regnamespace
          UNION ALL SELECT proname FROM pg_proc WHERE pronamespace = current_schema()::regnamespace
          UNION ALL SELECT tgname FROM pg_trigger WHERE NOT tgisinternal
        `
      expect(names.length).toBeGreaterThan(12)
      expect(names.map(({ name }) => name).filter((name) => !name.startsWith('effecttea_'))).toEqual([])
    }).pipe(Effect.orDie)))

// Within an operator's transaction the migrations were a savepoint. On PostgreSQL its lock came after the caller's
// snapshot, which a second launch could read without the history the first had committed: bug 51 of the roadmap
// (decision 0279).
test('createTables dies within a transaction of its client and makes nothing, and runs outside one', () =>
  onEach(['sqlite', 'pg'], (dialect) =>
    Effect.runPromise(
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient
        expect(yield* diesWith(sql.withTransaction(createTables))).toBe(
          'createTables runs within a transaction of its client: run it on the client outside any transaction',
        )
        const made = dialect === 'sqlite'
          ? yield* sql`SELECT name FROM sqlite_master WHERE name LIKE 'effecttea%'`
          : yield* sql`SELECT relname FROM pg_class WHERE relname LIKE 'effecttea%'`
        expect(made).toEqual([])
        yield* createTables
        yield* tablesMade
      }).pipe(Effect.provide(client(dialect)), Effect.orDie),
    )))

/**
 * Runs `body` in one transaction, so that a setting made with `SET LOCAL` holds for each of its statements: a server
 * runs each statement outside a transaction on any connection of its pool. `createTables` dies there, so the tests
 * within one run `migrate`, the migrations it runs once it has checked (decision 0279).
 */
const inOneTransaction = <A, E, R>(body: Effect.Effect<A, E, R>) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) => sql.withTransaction(body))

// No statement of the storage names a schema, so a client whose search_path names one puts every object there.
test('on PostgreSQL every object the runtime makes is in the schema its client’s search_path names', () =>
  Effect.runPromise(
    inOneTransaction(Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE SCHEMA runtime`
      yield* sql`SET LOCAL search_path TO runtime`
      yield* migrate
      yield* storage(ranked, sql).indexed
      yield* storage(receiver, sql).write('r', created(), 0)
      const placed = yield* sql<{ schema: string; name: string }>`
        SELECT nspname AS schema, relname AS name FROM pg_class JOIN pg_namespace ON pg_namespace.oid = relnamespace
        WHERE starts_with(relname, 'effecttea_')
        UNION ALL SELECT nspname, proname FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pronamespace
        WHERE starts_with(proname, 'effecttea_')
        UNION ALL SELECT nspname, tgname FROM pg_trigger JOIN pg_class ON pg_class.oid = tgrelid
        JOIN pg_namespace ON pg_namespace.oid = relnamespace WHERE NOT tgisinternal
      `
      expect(placed.length).toBeGreaterThan(16)
      expect(placed.filter(({ schema }) => schema !== 'runtime')).toEqual([])
    })).pipe(Effect.provide(client('pg')), Effect.orDie),
  ))

// `Migrator` is given its table unnamed, since `sql` splits a name at each dot.
test('on PostgreSQL a launch makes the tables in a schema whose name holds a dot', () =>
  Effect.runPromise(
    inOneTransaction(Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      yield* sql`CREATE SCHEMA "run.time"`
      yield* sql`SET LOCAL search_path TO "run.time"`
      yield* migrate
      yield* tablesMade
      yield* storage(receiver, sql).write('r', created(), 0)
      expect((yield* objectsIn(sql, 'run.time')).length).toBeGreaterThan(16)
    })).pipe(Effect.provide(client('pg')), Effect.orDie),
  ))

/** The objects of PostgreSQL in `schema`: its relations and its functions. */
const objectsIn = (sql: SqlClient.SqlClient, schema: string) =>
  sql<{ name: string }>`
    SELECT relname AS name FROM pg_class JOIN pg_namespace ON pg_namespace.oid = relnamespace WHERE nspname = ${schema}
    UNION ALL SELECT proname FROM pg_proc JOIN pg_namespace ON pg_namespace.oid = pronamespace WHERE nspname = ${schema}
  `

/** The message `effect` dies with, or null where it does not die. */
const diesWith = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.map(Effect.exit(effect), (exit) => {
    const cause = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null
    return cause instanceof Error ? cause.message : null
  })

// `Migrator` finds `effecttea_migrations` in `public`, and the schema the search_path names first would be given no
// table. Named with that schema, it made a second set of tables, empty, there. The launch dies before `Migrator`
// makes its table, and makes nothing in either schema.
test('on PostgreSQL a launch dies where a schema further on the search_path holds the tables, and makes nothing', () =>
  Effect.runPromise(
    inOneTransaction(Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      yield* migrate
      const held = (yield* objectsIn(sql, 'public')).length
      yield* sql`CREATE SCHEMA runtime`
      yield* sql`SET LOCAL search_path TO runtime, public`
      expect(yield* diesWith(migrate)).toBe(
        "the tables are in the schema 'public', and the search_path names 'runtime' before it, where a launch would " +
          "make tables of its own: set the role's search_path to the schema that holds the tables, or move the " +
          "tables into 'runtime'",
      )
      expect(yield* objectsIn(sql, 'runtime')).toEqual([])
      expect((yield* objectsIn(sql, 'public')).length).toBe(held)
      // With the search_path set to the schema that holds the tables, the launch runs on them.
      yield* sql`SET LOCAL search_path TO public`
      yield* migrate
    })).pipe(Effect.provide(client('pg')), Effect.orDie),
  ))

// Under the default search_path, a schema of the role's name made after the tables moves `current_schema()` in front
// of `public`. With the history named in `current_schema()`, the launch made new tables there, and the runtime read
// them, empty, with no error: bug 41 of the roadmap (decision 0263).
test('on PostgreSQL a schema of the role’s name made after the tables makes the launch die, with the entities kept', () =>
  Effect.runPromise(
    inOneTransaction(Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      yield* sql`SET LOCAL search_path TO "$user", public`
      yield* migrate
      yield* storage(receiver, sql).write('r', created(), 0)
      expect(yield* sql`SELECT current_schema() AS schema`).toEqual([{ schema: 'public' }])
      // An operator, or the application, makes a schema for the role, as `CREATE SCHEMA AUTHORIZATION` names it.
      yield* sql`CREATE SCHEMA AUTHORIZATION CURRENT_USER`
      const role = (yield* sql<{ role: string }>`SELECT current_user AS role`)[0]?.role ?? ''
      expect(yield* diesWith(migrate)).toContain(
        `the tables are in the schema 'public', and the search_path names '${role}' before it`,
      )
      expect(yield* objectsIn(sql, role)).toEqual([])
      yield* sql`SET LOCAL search_path TO public`
      expect((yield* storage(receiver, sql).load('r')) === null).toBe(false)
    })).pipe(Effect.provide(client('pg')), Effect.orDie),
  ))

// `tablesMade` reads the tables a launch would read, so it dies where the launch dies, before it reads the history
// (decisions 0247, 0263).
test('on PostgreSQL tablesMade dies where a schema further on the search_path holds the tables', () =>
  Effect.runPromise(
    inOneTransaction(Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient
      yield* migrate
      yield* tablesMade
      yield* sql`CREATE SCHEMA runtime`
      yield* sql`SET LOCAL search_path TO runtime, public`
      expect(yield* diesWith(tablesMade)).toContain("the tables are in the schema 'public'")
    })).pipe(Effect.provide(client('pg')), Effect.orDie),
  ))

// Without the prefix, a launch took an application's `versions` for its own and gave it a column, and a rename moved
// the rows of its `consumers` (decision 0198).
test('a launch leaves alone the tables of an application named as the runtime once named its own', () =>
  database((sql) =>
    Effect.gen(function*() {
      yield* sql`CREATE TABLE versions (name TEXT PRIMARY KEY, version INTEGER NOT NULL)`
      yield* sql`CREATE TABLE consumers (name TEXT NOT NULL)`
      yield* sql`CREATE TABLE log (level TEXT NOT NULL, message TEXT NOT NULL)`
      yield* sql`INSERT INTO versions VALUES ('Receiver', 7)`
      yield* sql`INSERT INTO consumers VALUES ('Receiver')`
      yield* sql`INSERT INTO log VALUES ('info', 'started')`
      const columns = (table: string) =>
        dialectOf(sql) === 'sqlite'
          ? sql<{ name: string }>`SELECT name FROM pragma_table_info(${table}) ORDER BY cid`
          : sql<{ name: string }>`
            SELECT column_name AS name FROM information_schema.columns
            WHERE table_schema = current_schema() AND table_name = ${table} ORDER BY ordinal_position
          `
      yield* Effect.provideService(createTables, SqlClient.SqlClient, sql)
      yield* storage(receiver, sql).write('r', created(), 0)
      expect(yield* columns('versions')).toEqual([{ name: 'name' }, { name: 'version' }])
      expect(yield* columns('consumers')).toEqual([{ name: 'name' }])
      expect(yield* columns('log')).toEqual([{ name: 'level' }, { name: 'message' }])
      expect(yield* sql`SELECT name, version FROM versions`).toEqual([{ name: 'Receiver', version: 7 }])
      expect(yield* sql`SELECT name FROM consumers`).toEqual([{ name: 'Receiver' }])
      expect(yield* sql`SELECT level, message FROM log`).toEqual([{ level: 'info', message: 'started' }])
    }).pipe(Effect.orDie)))

// With `IF NOT EXISTS`, a launch took a table of the application under one of the runtime's names for its own. The
// migration runs in one transaction, so the objects it made before the clash go with it. `Migrator` makes its own
// table before the transaction, and records nothing in it (decision 0218).
test('a launch on a database that holds a table named as one of the runtime’s dies, and leaves no object of its own', () =>
  onEach(['sqlite', 'pg'], (dialect) =>
    Effect.runPromise(
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient
        yield* sql`CREATE TABLE effecttea_answers (name TEXT NOT NULL)`
        yield* sql`INSERT INTO effecttea_answers VALUES ('Receiver')`
        const launched = yield* Effect.exit(createTables)
        expect(Exit.isFailure(launched) ? String(launched.cause) : null).toContain('effecttea_answers')
        const names = dialect === 'sqlite'
          ? yield* sql<{ name: string }>`SELECT name FROM sqlite_master WHERE name <> 'sqlite_sequence' ORDER BY name`
          : yield* sql<{ name: string }>`
            SELECT relname AS name FROM pg_class WHERE relnamespace = current_schema()::regnamespace
            UNION ALL SELECT proname FROM pg_proc WHERE pronamespace = current_schema()::regnamespace
            UNION ALL SELECT tgname FROM pg_trigger WHERE NOT tgisinternal
            ORDER BY name
          `
        expect(names.map(({ name }) => name).filter((name) => !name.endsWith('_pkey') && !name.endsWith('_seq')))
          .toEqual(['effecttea_answers', 'effecttea_migrations'])
        expect(yield* sql`SELECT migration_id FROM effecttea_migrations`).toEqual([])
        expect(yield* sql`SELECT name FROM effecttea_answers`).toEqual([{ name: 'Receiver' }])
      }).pipe(Effect.provide(client(dialect)), Effect.orDie),
    )))

// A table and an index share one namespace on both dialects, so a table of the application under the name of any
// table or index the first migration makes must make the launch die, and not only under `effecttea_answers`
// (decision 0218).
test('a launch dies on a table of the application under the name of any table or index the runtime makes', () =>
  onEach(['sqlite', 'pg'], async (dialect) => {
    const relations = (sql: SqlClient.SqlClient) =>
      dialect === 'sqlite'
        ? sql<{ name: string }>`
          SELECT name FROM sqlite_master WHERE type IN ('table', 'index') AND name LIKE 'effecttea\\_%' ESCAPE '\\'
          ORDER BY name
        `
        : sql<{ name: string }>`
          SELECT relname AS name FROM pg_class WHERE relnamespace = current_schema()::regnamespace
            AND relkind IN ('r', 'i') AND relname LIKE 'effecttea\\_%' AND relname NOT LIKE '%\\_pkey'
          ORDER BY name
        `
    const made = await Effect.runPromise(
      Effect.gen(function*() {
        const sql = yield* SqlClient.SqlClient
        yield* createTables
        // `effecttea_migrations` is made by `Migrator` before the migration, and is no object of the migration.
        return (yield* relations(sql)).map(({ name }) => name).filter((name) => name !== 'effecttea_migrations')
      }).pipe(Effect.provide(client(dialect)), Effect.orDie),
    )
    expect(made.length).toBeGreaterThan(10)
    // `bun test` tries one name in four, from the first, within its budget, and a release every name (decision 0250).
    for (const name of made.filter((_, at) => Bun.env['SCHEDULES'] === 'all' || at % 4 === 0)) {
      const died = await Effect.runPromise(
        Effect.gen(function*() {
          const sql = yield* SqlClient.SqlClient
          yield* sql.unsafe(`CREATE TABLE "${name}" (x TEXT)`)
          const launched = yield* Effect.exit(createTables)
          return Exit.isFailure(launched)
        }).pipe(Effect.provide(client(dialect)), Effect.orDie),
      )
      expect({ name, died }).toEqual({ name, died: true })
    }
  }), 120_000)

// PostgreSQL compares text by the collation of its column, and the database's own may order by language. Every text
// column the storage makes is `C`, which compares bytes as SQLite's `BINARY` does. PGlite's database is `C` itself,
// so the order of the read model's ids is the same without the collation, and the test reads it off the columns
// (decision 0157).
test('on PostgreSQL every text column the storage makes compares bytes', () =>
  database((sql) =>
    Effect.gen(function*() {
      yield* storage(ranked, sql).indexed
      // `effecttea_migrations` is made by `Migrator`, and nothing of the runtime compares its text (decision 0216).
      const columns = yield* sql<{ table_name: string; column_name: string; collation_name: string | null }>`
        SELECT table_name, column_name, collation_name FROM information_schema.columns
        WHERE table_schema = current_schema() AND data_type = 'text' AND table_name <> 'effecttea_migrations'
      `
      expect(columns.length).toBeGreaterThan(0)
      expect(columns.filter((column) => column.collation_name !== 'C')).toEqual([])
    }).pipe(Effect.orDie), ['pg']))

// PostgreSQL keeps the first 63 bytes of a name. Two indexes whose long names share their first bytes are two
// indexes, each named by the hash of its whole name (decision 0157).
test('on PostgreSQL two long names of indexes that share their first bytes name two indexes', () =>
  database((sql) =>
    Effect.gen(function*() {
      const long = 'a'.repeat(60)
      const program = {
        ...ranked,
        indexes: { [`${long}1`]: ranked.indexes.rank, [`${long}2`]: ranked.indexes.rank },
      } as unknown as Program<Ranked>
      yield* storage(program, sql).indexed
      const indexes = yield* sql<{ indexname: string }>`
        SELECT indexname FROM pg_indexes WHERE schemaname = current_schema() AND indexname LIKE ${`effecttea_projections Ranked %`}
      `
      expect(new Set(indexes.map(({ indexname }) => indexname)).size).toBe(2)
    }).pipe(Effect.orDie), ['pg']))

// PostgreSQL uses an index of an expression only where the statement writes the expression as the index does. The
// test records the statements the storage runs, and reads the plan of each with scans of whole tables turned off: an
// index that serves a page holds its order, so that no plan sorts (decision 0157).
test('on PostgreSQL a page and a caller’s reply by its request id are read by their indexes', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(ranked, sql)
      yield* store.indexed
      for (const [id, rank] of [['a', 1], ['b', 'x'], ['c', null]] as const) {
        yield* store.write(id, created({ shown: { projection: id, indexes: { rank } } }), 0)
      }
      const plans = <A>(reading: Effect.Effect<A>) =>
        Effect.gen(function*() {
          const ran: Array<readonly [string, ReadonlyArray<unknown>]> = []
          const record: Statement.Transformer = (statement) =>
            Effect.sync(() => {
              ran.push(statement.compile())
              return statement
            })
          yield* Effect.provideService(reading, Statement.CurrentTransformer, record)
          const read: Array<string> = []
          yield* sql.withTransaction(Effect.gen(function*() {
            yield* sql`SET LOCAL enable_seqscan = off`
            for (const [text, params] of ran) {
              if (!text.trimStart().startsWith('SELECT')) continue
              const plan = yield* sql.unsafe<{ 'QUERY PLAN': string }>(`EXPLAIN ${text}`, params)
              read.push(plan.map((line) => line['QUERY PLAN']).join('\n'))
            }
          }))
          return read
        })
      const page = /Index (Only )?Scan (Backward )?using "effecttea_projections Ranked rank by id"/
      const pages = [
        ...yield* plans(store.query({ limit: all, order: { index: 'rank' }, after: { id: 'a', indexes: { rank: 1 } } })),
        ...yield* plans(
          store.query({ limit: all, order: { index: 'rank', descending: true }, after: { id: 'b', indexes: { rank: 'x' } } }),
        ),
      ]
      expect(pages.length).toBeGreaterThan(3)
      for (const plan of pages) {
        expect(plan).toMatch(page)
        expect(plan).not.toContain('Sort')
      }
      const replies = yield* plans(storage(receiver, sql).reply('r', { _tag: 'Caller', sender: null, id: 'x' }, 0))
      expect(replies.at(-1)).toContain('effecttea_replies_by_request_id')
    }).pipe(Effect.orDie), ['pg']))

/**
 * Version 2 of the receiver, which marks what it reads of version 1: each kind of value is read through a migration
 * of its own, and a row version 2 wrote is read with no mark.
 */
const marked: Program<T> = {
  ...receiver,
  migrations: [{
    state: (json) => ({ ...json as Readonly<Record<string, Json>>, last: 'migrated' }),
    inbound: (json) => `${String(json)} (inbound)`,
    internal: (json) => `${String(json)} (internal)`,
    projection: (json) => `${String(json)} (projection)`,
  }],
}

/** The rows of a creation with a timer under way and two messages queued. */
const busy = created({
  keys: [{ key: { name: 'ask' }, incarnation: 1, work: { _tag: 'Timer', at: 0, message: 'rang' }, delivery: null, due: 0 }],
  queued: [inbound('hello'), { _tag: 'Internal', message: 'done', key: { name: 'ask' }, incarnation: 1 }],
})

test('a version reads through its migrations the work and the mailbox another version wrote', () =>
  database((sql) =>
    Effect.gen(function*() {
      const first = storage(receiver, sql)
      yield* first.write('r', busy, 0)
      const after = storage(marked, sql)
      const stored = yield* after.load('r')
      const work = stored?.keys[Machine.keyText({ name: 'ask' })]?.work
      expect(work !== undefined && isTimer(work) ? work.message : null).toBe('rang (internal)')
      expect(stored?.mailbox.map(({ message }) => message)).toEqual(['hello (inbound)', 'done (internal)'])
      // A read gives the row through the projection's migrations, as a query does (decision 0121).
      expect(yield* after.projected('r')).toBe('start (projection)')
    })))

test('reindex skips an entity that a step wrote since, though its state has the same text at another version', () =>
  database((sql) =>
    Effect.gen(function*() {
      const first = storage(receiver, sql)
      yield* first.write('a', created({ entity: { state: { last: 'x' }, creation, flags: null } }), 0)
      yield* first.write('b', created({ entity: { state: { last: 'x' }, creation, flags: null } }), 0)
      // As 'a''s row is written, version 2 steps 'b' to the state it writes as the same text, which it reads as
      // its own, with no migration: the step lands between the reading of 'b' and the writing of its row.
      const step = `
        UPDATE effecttea_entities SET version = 2 WHERE name = 'Receiver' AND id = 'b';
        UPDATE effecttea_projections SET projection = '"x"', version = 2 WHERE name = 'Receiver' AND id = 'b';
      `
      if (dialectOf(sql) === 'pg') {
        yield* sql.unsafe(`
          CREATE FUNCTION step() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.id = 'a' THEN ${step} END IF;
            RETURN NULL;
          END $$
        `)
        yield* sql`CREATE TRIGGER step AFTER UPDATE ON effecttea_projections FOR EACH ROW EXECUTE FUNCTION step()`
      } else {
        yield* sql.unsafe(`CREATE TEMP TRIGGER step AFTER UPDATE ON effecttea_projections WHEN NEW.id = 'a' BEGIN ${step} END`)
      }
      const after = storage(marked, sql)
      expect(yield* after.reindex).toEqual({ written: 1, failed: [] })
      expect(yield* after.query({ limit: all })).toEqual([{ id: 'a', projection: 'migrated', indexes: {} }, { id: 'b', projection: 'x', indexes: {} }])
    }).pipe(Effect.orDie)))

// `reindex` writes a row only over the state it computed the row from, so a step that lands between its reading and
// its writing keeps the row it wrote.
test('reindex skips an entity that a step moved to another state since its reading', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(receiver, sql)
      yield* store.write('a', created({ entity: { state: { last: 'x' }, creation, flags: null } }), 0)
      yield* store.write('b', created({ entity: { state: { last: 'x' }, creation, flags: null } }), 0)
      // As the row of 'a' is written, a step moves 'b' to the state 'y' and writes its row: the step lands between
      // the reading of 'b' and the writing of its row.
      const step = `
        UPDATE effecttea_entities SET state = '{"last":"y"}' WHERE name = 'Receiver' AND id = 'b';
        UPDATE effecttea_projections SET projection = '"y"' WHERE name = 'Receiver' AND id = 'b';
      `
      if (dialectOf(sql) === 'pg') {
        yield* sql.unsafe(`
          CREATE FUNCTION step() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.id = 'a' THEN ${step} END IF;
            RETURN NULL;
          END $$
        `)
        yield* sql`CREATE TRIGGER step AFTER UPDATE ON effecttea_projections FOR EACH ROW EXECUTE FUNCTION step()`
      } else {
        yield* sql.unsafe(`CREATE TEMP TRIGGER step AFTER UPDATE ON effecttea_projections WHEN NEW.id = 'a' BEGIN ${step} END`)
      }
      expect(yield* store.reindex).toEqual({ written: 1, failed: [] })
      expect((yield* store.query({ limit: all })).map(({ id, projection }) => [id, projection])).toEqual([['a', 'x'], ['b', 'y']])
    }).pipe(Effect.orDie)))

// What the program computes of a row leaves that entity's row, and what the runtime throws fails the call
// (decisions 0061, 0122).
test('reindex passes over a state a migration or the schema dies on, and fails on a text that is no JSON', () =>
  database((sql) =>
    Effect.gen(function*() {
      const first = storage(receiver, sql)
      for (const id of ['a', 'b', 'c']) {
        yield* first.write(id, created({ entity: { state: { last: id }, creation, flags: null } }), 0)
      }
      // Version 2 dies on 'b' in its migration, and migrates 'c' to a state its schema refuses.
      const dying: Program<T> = {
        ...receiver,
        migrations: [{
          state: (json) => {
            const { last } = json as Readonly<{ last: string }>
            if (last === 'b') throw new Error('the migration dies')
            return last === 'c' ? { last: 3 } : json
          },
        }],
      }
      const after = storage(dying, sql)
      const reindexed = yield* after.reindex
      expect(reindexed.written).toBe(1)
      expect(reindexed.failed.map(({ id }) => id)).toEqual(['b', 'c'])
      expect(reindexed.failed[0]?.cause).toBe('Error: the migration dies')
      // The rows passed over are the ones version 1 wrote.
      expect(yield* after.query({ limit: all })).toEqual([
        { id: 'a', projection: 'a', indexes: {} },
        { id: 'b', projection: 'start', indexes: {} },
        { id: 'c', projection: 'start', indexes: {} },
      ])
      yield* sql`UPDATE effecttea_entities SET state = 'no json' WHERE name = 'Receiver' AND id = 'a'`
      const exit = yield* Effect.exit(after.reindex)
      expect(Exit.isFailure(exit) && Cause.squash(exit.cause) instanceof SyntaxError).toBe(true)
    }).pipe(Effect.orDie)))

test('a query by an index the program does not declare dies, naming it', () =>
  database((sql) =>
    Effect.gen(function*() {
      // A name is written into the query as it is, so only the program's own are: the types say so, and a cast
      // that passes them still reaches nothing.
      for (
        const query of [{ limit: all, where: [{ index: 'nope', is: '=', value: 1 }] }, { limit: all, order: { index: 'nope' } }]
      ) {
        const exit = yield* Effect.exit(storage(receiver, sql).query(query as never))
        const cause = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null
        expect(cause instanceof Error && cause.message).toBe("'nope' is no index of the program 'Receiver'")
      }
    })))

/** A receiver whose projection is its rank, as JSON: an index of numbers that tie, of nulls and of a string. */
type Ranked = Omit<T, 'index'> & { index: 'rank' }
const ranked: Program<Ranked> = {
  ...(named('Ranked') as unknown as Program<Ranked>),
  indexes: { rank: (projection) => JSON.parse(projection) as Scalar },
}

test('a query pages past the last row it gave, through ties and nulls, in either order', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(ranked, sql)
      const ranks: Readonly<Record<string, Scalar>> = { a: 2, b: null, c: 1, d: 2, e: null, f: 1, g: 2, h: 'x' }
      for (const [id, rank] of Object.entries(ranks)) {
        const projection = JSON.stringify(rank)
        yield* store.write(id, created({ shown: { projection, indexes: { rank } } }), 0)
      }
      /** Every page of `query`, `limit` rows at a time, each read past the last row of the page before. */
      const paged = (query: Omit<Query<Ranked>, 'limit' | 'after'>, limit: number) =>
        Effect.gen(function*() {
          const ids: Array<string> = []
          let after: Found<Ranked> | undefined
          while (true) {
            const page = yield* store.query({ ...query, limit, after })
            ids.push(...page.map(({ id }) => id))
            after = page[page.length - 1]
            // A query that reads no row past its cursor would give the same page for ever.
            if (after === undefined || ids.length > Object.keys(ranks).length) return ids
          }
        })
      // SQLite sorts null first, numbers before text, and the id breaks the ties: a descending order is the
      // ascending one reversed, ids included (decision 0145). A criterion compares across types in the same
      // order, so 'x' is `>= 1` (decision 0143).
      const orders = [
        [{}, ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']],
        [{ order: { index: 'rank' } }, ['b', 'e', 'c', 'f', 'a', 'd', 'g', 'h']],
        [{ order: { index: 'rank', descending: true } }, ['h', 'g', 'd', 'a', 'f', 'c', 'e', 'b']],
        [{ order: { index: 'rank' }, where: [{ index: 'rank', is: '>=', value: 1 }] }, ['c', 'f', 'a', 'd', 'g', 'h']],
      ] as const
      for (const [query, ids] of orders) {
        expect(yield* store.query({ ...query, limit: all })).toHaveLength(ids.length)
        for (const limit of [1, 2, 3]) expect(yield* paged(query, limit)).toEqual([...ids])
      }
      // A row carries the indexes the query compared, as stored: the cursor is the row itself.
      expect((yield* store.query({ limit: 1, order: { index: 'rank' } }))[0]).toEqual({
        id: 'b',
        projection: 'null',
        indexes: { rank: null },
      })
    })))

// The index holds the id after the value, so that each part of a page is a range of it (decision 0145).
test('an index of the program holds the value and the id', () =>
  database((sql) =>
    Effect.gen(function*() {
      const column = `json_extract(indexes, '$.rank')`
      yield* storage(ranked, sql).indexed
      const made = yield* sql<{ name: string; sql: string }>`
        SELECT name, sql FROM sqlite_master WHERE type = 'index' AND name LIKE 'effecttea_projections %'
      `
      expect(made).toEqual([{
        name: 'effecttea_projections Ranked rank by id',
        sql: `CREATE INDEX "effecttea_projections Ranked rank by id" ON effecttea_projections (name, ${column}, id)`,
      }])
    }).pipe(Effect.orDie), ['sqlite']))

// Under every schedule within one deviation, a step moves a row from the rows that tie with the cursor to the rows
// past its value while a page reads them, and the page gives it once (decision 0145).
test('a cursor that holds no id, or no scalar of the index ordered by, is its caller’s defect', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(ranked, sql)
      const order = { index: 'rank' } as const
      const refused = [
        store.query({ limit: all, after: null as never }),
        store.query({ limit: all, after: { id: 1, indexes: { rank: 1 } } as never }),
        store.query({ limit: all, order, after: { id: 'a', indexes: {} } as never }),
        store.query({ limit: all, order, after: { id: 'a', indexes: { rank: Number.NaN } } }),
        store.query({ limit: all, order, after: { id: 'a', indexes: { rank: [] } } as never }),
      ]
      for (const call of refused) {
        const exit = yield* Effect.exit(call)
        const cause = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null
        expect(cause instanceof InvariantDefect && cause.reason).toMatch(/^the (row|id|index 'rank') after is .+, which is no/)
      }
    })))

// SQLite finds no row under `NaN`, where PostgreSQL holds it a number past every other, and PostgreSQL takes no
// U+0000 in a parameter of text: each dialect would answer otherwise, so each is refused alike (decision 0207).
test('a criterion or a cursor that is no scalar a query compares is its caller’s defect, on both dialects', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(ranked, sql)
      yield* store.write('a', created({ shown: { projection: '1', indexes: { rank: 1 } } }), 0)
      const unheld: ReadonlyArray<unknown> = [Number.NaN, Number.POSITIVE_INFINITY, 'a\u0000', '\ud800', undefined, []]
      for (const value of unheld) {
        const where = [{ index: 'rank', is: '<', value: value as never }] as const
        const shown = typeof value === 'string' || typeof value === 'object' ? JSON.stringify(value) : String(value)
        const exit = yield* Effect.exit(store.query({ limit: all, where }))
        const cause = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null
        expect(cause instanceof InvariantDefect && cause.reason)
          .toBe(`the value compared with the index 'rank' is ${shown}, which is no scalar a query compares`)
      }
      const order = { index: 'rank' } as const
      const cursors = [
        [{ id: 'a\u0000', indexes: { rank: 1 } }, 'the id after is "a\\u0000", which is no string a query compares'],
        [{ id: 'a', indexes: { rank: 'x\u0000' } }, `the index 'rank' after is "x\\u0000", which is no scalar`],
      ] as const
      for (const [after, reason] of cursors) {
        const exit = yield* Effect.exit(store.query({ limit: all, order, after }))
        const cause = Exit.isFailure(exit) ? Cause.squash(exit.cause) : null
        expect(cause instanceof InvariantDefect && cause.reason).toBe(reason)
      }
      // A criterion every database holds still finds the row.
      expect(yield* store.query({ limit: all, where: [{ index: 'rank', is: '<', value: 2 }] })).toHaveLength(1)
    })))

// A query binds a criterion's value and a cursor as parameters, which no index holds, and each dialect compares a
// long string as it compares a short one: so the bound of a text that keys a row does not refuse them.
test('a criterion or a cursor whose string is past the bound of a text that keys a row is compared, on both dialects', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(ranked, sql)
      yield* store.write('a', created({ shown: { projection: '1', indexes: { rank: 'b' } } }), 0)
      const long = 'c'.repeat(keyedBytes)
      expect(yield* store.query({ limit: all, where: [{ index: 'rank', is: '<', value: long }] })).toHaveLength(1)
      expect(yield* store.query({ limit: all, where: [{ index: 'rank', is: '=', value: long }] })).toHaveLength(0)
      const order = { index: 'rank', descending: true } as const
      const after = { id: long, indexes: { rank: long } }
      expect((yield* store.query({ limit: all, order, after })).map(({ id }) => id)).toEqual(['a'])
    })))

// `JSON.stringify` writes an integer beyond 2^53 with the fewest digits that read back as it, which SQLite reads as
// another integer: without the exact digits, the page gives the row for ever, and a criterion misses it (decision 0146).
test('a query pages past, and finds by its value, a row whose index is an integer beyond 2^53', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(ranked, sql)
      const nanos = 1762300123456789012
      const ranks: Readonly<Record<string, Scalar>> = { a: nanos, b: 2 ** 60, c: 2 ** 60, d: 5 }
      for (const [id, rank] of Object.entries(ranks)) {
        yield* store.write(id, created({ shown: { projection: JSON.stringify(rank), indexes: { rank } } }), 0)
      }
      const stored = yield* sql<{ id: string; indexes: string }>`SELECT id, indexes FROM effecttea_projections ORDER BY id`
      expect(stored.map(({ indexes }) => indexes)).toEqual([
        '{"rank":1762300123456788992}',
        '{"rank":1152921504606846976}',
        '{"rank":1152921504606846976}',
        '{"rank":5}',
      ])
      const ids: Array<string> = []
      let after: Found<Ranked> | undefined
      while (ids.length <= 4) {
        const page = yield* store.query({ limit: 1, order: { index: 'rank' }, after })
        after = page[0]
        if (after === undefined) break
        ids.push(after.id)
      }
      expect(ids).toEqual(['d', 'b', 'c', 'a'])
      expect(after).toBeUndefined()
      expect((yield* store.query({ limit: all, where: [{ index: 'rank', is: '=', value: 2 ** 60 }] })).map(({ id }) => id))
        .toEqual(['b', 'c'])
      expect((yield* store.query({ limit: 1, order: { index: 'rank' }, after: { id: 'b', indexes: { rank: 2 ** 60 } } }))[0])
        .toEqual({ id: 'c', projection: '1152921504606847000', indexes: { rank: 2 ** 60 } })
    }).pipe(Effect.orDie)))

// The outbox is the deploy's choice.
test('a step writes its row of the outbox only where the storage keeps the outbox', () =>
  database((sql) =>
    Effect.gen(function*() {
      const step = written({ published: { kind: 'Inbound', message: 'm', projection: 'projected' } })
      const kept = storage(receiver, sql, true)
      yield* kept.write('a', created(), 0)
      yield* kept.write('a', step, 0)
      const unkept = storage(receiver, sql)
      yield* unkept.write('b', created(), 0)
      yield* unkept.write('b', step, 0)
      const rows = yield* sql<{ id: string }>`SELECT id FROM effecttea_outbox ORDER BY id`
      expect(rows.map(({ id }) => id)).toEqual(['a'])
    }).pipe(Effect.orDie)))

// `reindex` writes the indexes as a step does, so a row it writes again is found by its value (decision 0146).
test('reindex writes an index that is an integer beyond 2^53 with its exact digits', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(ranked, sql)
      const state = { last: JSON.stringify(2 ** 60) }
      yield* store.write('a', created({ entity: { state, creation, flags: null }, shown: { projection: '0', indexes: { rank: 0 } } }), 0)
      expect(yield* store.reindex).toEqual({ written: 1, failed: [] })
      const stored = yield* sql<{ indexes: string }>`SELECT indexes FROM effecttea_projections`
      expect(stored).toEqual([{ indexes: '{"rank":1152921504606846976}' }])
    }).pipe(Effect.orDie)))

// An index is computed as `project` is, inside the guard of the program's code, so one that dies on a state leaves
// that entity's row and names it, as a `project` that dies does (decision 0122).
test('reindex passes over a state an index dies on, names it, and writes the rest', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(ranked, sql)
      for (const [id, last] of [['a', '1'], ['b', 'no json'], ['c', '3']] as const) {
        yield* store.write(id, created({ entity: { state: { last }, creation, flags: null }, shown: { projection: '0', indexes: { rank: 0 } } }), 0)
      }
      const reindexed = yield* store.reindex
      expect(reindexed.written).toBe(2)
      expect(reindexed.failed.map(({ id }) => id)).toEqual(['b'])
      expect(reindexed.failed[0]?.cause).toContain('SyntaxError')
      expect((yield* store.query({ limit: all })).map(({ id, indexes }) => [id, indexes.rank])).toEqual([
        ['a', 1],
        ['b', 0],
        ['c', 3],
      ])
    }).pipe(Effect.orDie)))

/** A text of `length` letters that compresses little, drawn from `seed`. */
const lettersOf = (length: number, seed: number) =>
  Array.from({ length }, () => {
    seed = (seed * 48_271) % 2_147_483_647
    return String.fromCharCode(97 + (seed % 26))
  }).join('')

/** A text past the 2,704 bytes an entry of an index of PostgreSQL holds, and past the bound of a text that keys a row. */
const longText = lettersOf(4_000, 7)

/** What each dialect makes of `body`: its value, or the name of what it failed with. */
const onEachDialect = async <A>(body: (sql: SqlClient.SqlClient) => Effect.Effect<A, unknown>) => {
  const outcomes: Array<unknown> = []
  await database((sql) =>
    Effect.map(Effect.exit(body(sql)), (exit) =>
      outcomes.push(Exit.isSuccess(exit) ? exit.value : String(Cause.squash(exit.cause)).slice(0, 80))))
  return outcomes
}

// An entry of a B-tree index of PostgreSQL holds 2,704 bytes, where SQLite holds any text. The widest key of the
// storage is the one of `effecttea_waiting`, with seven texts and an integer. The widest key that holds a request is
// the one of `effecttea_replies`, with two texts, a request and an integer. So each part at its bound fits in both.
test('every text that keys a row, at its bound, is written alike on both dialects', async () => {
  const outcomes = await onEachDialect((sql) =>
    Effect.gen(function*() {
      const store = storage(ranked, sql)
      yield* store.indexed
      // A text is measured by its JSON, quotes and all.
      const at = (seed: number) => lettersOf(keyedBytes - 2, seed)
      yield* store.write(at(1), created({ shown: { projection: '0', indexes: { rank: at(2) } } }), 0)
      yield* sql`INSERT INTO effecttea_waiting ${
        sql.insert({
          name: at(3),
          id: at(4),
          sender_name: at(5),
          sender_id: at(6),
          sender_key: at(7),
          sender_parameter: JSON.stringify(at(8)),
          sender_incarnation: Number.MAX_SAFE_INTEGER,
          request: at(9),
        })
      }`
      yield* sql`INSERT INTO effecttea_replies ${
        sql.insert({ name: at(10), id: at(11), request: lettersOf(requestBytes, 12), tag: 'Accepted', version: 1 })
      }`
      return 'written'
    }))
  expect(outcomes).toEqual(['written', 'written'])
})

// `reindex` passes over what the program computes, and would die whole on a statement that fails. An index past the
// bound of a text is the program's, so `reindex` names its entity on both dialects.
test('reindex passes over an entity whose new index PostgreSQL cannot hold, alike on both dialects', async () => {
  const reindexed = await onEachDialect((sql) =>
    Effect.gen(function*() {
      const store = storage(ranked, sql)
      yield* store.indexed
      for (const [id, last] of [['a', '"a"'], ['b', JSON.stringify(longText)], ['c', '"c"']] as const) {
        yield* store.write(id, created({ entity: { state: { last }, creation, flags: null }, shown: { projection: '0', indexes: { rank: 0 } } }), 0)
      }
      const { written, failed } = yield* store.reindex
      return { written, failed: failed.map(({ id }) => id) }
    }))
  expect(reindexed[0]).toEqual(reindexed[1])
})

// Each statement of a page takes what the ones before it left of the limit, and a row found carries null for an
// index it lacks, as the query reads it (decisions 0143, 0145).
test('a page gives at most its limit across its statements, and null for an index a row lacks', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(ranked, sql)
      for (const [id, rank] of [['a', 1], ['b', 1], ['c', 2], ['d', 2]] as const) {
        yield* store.write(id, created({ shown: { projection: String(rank), indexes: { rank } } }), 0)
      }
      yield* store.write('e', created({ shown: { projection: 'null', indexes: {} } }), 0)
      const page = yield* store.query({ limit: 2, order: { index: 'rank' }, after: { id: 'a', indexes: { rank: 1 } } })
      expect(page.map(({ id }) => id)).toEqual(['b', 'c'])
      expect((yield* store.query({ limit: 1, order: { index: 'rank' } }))[0]).toEqual({
        id: 'e',
        projection: 'null',
        indexes: { rank: null },
      })
    }).pipe(Effect.orDie)))

test('a row is written at the version that writes it, and read back as it was written', () =>
  database((sql) =>
    Effect.gen(function*() {
      // Version 2 writes every row of the entity: one stamped with another version would be read through a
      // migration it never needed, and come back marked.
      const after = storage(marked, sql)
      yield* after.write('r', busy, 0)
      const stored = yield* after.load('r')
      expect(stored?.state).toEqual({ last: 'start' })
      const work = stored?.keys[Machine.keyText({ name: 'ask' })]?.work
      expect(work !== undefined && isTimer(work) ? work.message : null).toBe('rang')
      expect(stored?.mailbox.map(({ message }) => message)).toEqual(['hello', 'done'])
      expect(yield* after.query({ limit: all })).toEqual([{ id: 'r', projection: 'start', indexes: {} }])
    })))

// The time an entity suspended is kept while it stays suspended, and read with what it died on (decision 0114).
test('a suspended entity is listed with what it died on, its cause and since when, kept while it stays suspended', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(receiver, sql)
      const listed = Effect.map(store.suspended, (entities) =>
        entities.map(({ since, ...rest }) => ({ ...rest, since: DateTime.toEpochMillis(since) })))
      const onMessage = { on: { _tag: 'Message' }, cause: 'broken' } as const
      const onOperation = { on: { _tag: 'Operation', key: { name: 'ask' }, incarnation: 1 }, cause: 'died' } as const
      yield* store.write('fine', created(), 1)
      yield* store.write('inbound', created({ queued: [inbound('one')], suspension: onMessage }), 5)
      yield* store.write('operation', created({ suspension: onOperation }), 3)
      // The longest suspended first, each with the tag of the message it died on.
      expect(yield* listed).toEqual([
        { id: 'operation', on: onOperation.on, cause: 'died', since: 3, waiting: [] },
        { id: 'inbound', on: { _tag: 'Message', kind: 'Inbound' }, cause: 'broken', since: 5, waiting: [] },
      ])
      // A step while the entity stays suspended, a completion recorded or a state written, keeps the time.
      const completion: Machine.EnvelopeRow = { _tag: 'Internal', message: 'done', key: { name: 'ask' }, incarnation: 1 }
      yield* store.write('inbound', written({ queued: [completion], suspension: onMessage }), 9)
      yield* store.write(
        'operation',
        written({ entity: { state: { last: 'again' }, creation, flags: null }, suspension: onOperation }),
        10,
      )
      expect((yield* listed).map(({ id, since }) => [id, since])).toEqual([['operation', 3], ['inbound', 5]])
      // The step that takes the entity out of its suspension clears it, and a later suspension is timed anew.
      yield* store.write('inbound', written({ handled: 1 }), 12)
      expect((yield* listed).map(({ id }) => id)).toEqual(['operation'])
      yield* store.write('inbound', written({ suspension: onMessage }), 20)
      expect(yield* listed).toEqual([
        { id: 'operation', on: onOperation.on, cause: 'died', since: 3, waiting: [] },
        { id: 'inbound', on: { _tag: 'Message', kind: 'Internal' }, cause: 'broken', since: 20, waiting: [] },
      ])
    })))

// A time before 1970 is negative, and is read back as any other.
test('an entity suspended at a time before 1970 is loaded and listed', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(receiver, sql)
      const suspension = { on: { _tag: 'Message' }, cause: 'broken' } as const
      yield* store.write('old', created({ queued: [inbound('one')], suspension }), -5)
      expect((yield* store.load('old')) === null).toBe(false)
      expect((yield* store.suspended).map(({ id, since }) => [id, DateTime.toEpochMillis(since)])).toEqual([['old', -5]])
    })))

// A wait is stored by the step that answered `Suspended`, listed while the run that sent holds, and deleted by the
// step that takes the entity out of its suspension (decision 0265).
test('a suspended entity lists the stored waits whose run holds, and its resumption deletes them', () =>
  database((sql) =>
    Effect.gen(function*() {
      const store = storage(receiver, sql)
      const work = { _tag: 'Operation', operation: { _tag: 'Ask' } }
      const waiting = Effect.map(store.suspended, (entities) => entities.map(({ id, waiting }) => [id, waiting]))
      const run = (incarnation: number) =>
        ({ key: { name: 'ask' }, incarnation, work, delivery: 'Idempotent', due: null }) as const
      const wait = (id: string, incarnation: number, name: string): Machine.Wait => ({
        asked: { name: 'Asker', id, key: { name: 'ask' }, incarnation },
        name,
      })
      const onMessage = { on: { _tag: 'Message' }, cause: 'broken' } as const
      yield* storage(asker, sql).write('a', created({ keys: [run(1)], incarnations: 1 }), 0)
      yield* storage(asker, sql).write('b', created({ keys: [run(1)], incarnations: 1 }), 0)
      yield* store.write('r', created({ queued: [inbound('one')], suspension: onMessage }), 1)
      // A wait answered twice is stored once.
      yield* store.write('r', written({ waits: [wait('b', 1, 'want'), wait('a', 1, 'want')], suspension: onMessage }), 2)
      yield* store.write('r', written({ waits: [wait('a', 1, 'want')], suspension: onMessage }), 3)
      const listedOf = (id: string) => ({ entity: { name: 'Asker', id }, key: { name: 'ask' }, incarnation: 1, name: 'want' })
      expect(yield* waiting).toEqual([['r', [listedOf('a'), listedOf('b')]]])
      expect((yield* store.inspect('r'))?.suspension?.waiting).toEqual([listedOf('a'), listedOf('b')])
      // A run restarted under another incarnation no longer waits, nor does one whose work ended.
      yield* storage(asker, sql).write('a', written({ keys: [run(2)], incarnations: 2 }), 4)
      yield* storage(asker, sql).write('b', written({ gone: [{ name: 'ask' }] }), 4)
      expect(yield* waiting).toEqual([['r', []]])
      yield* storage(asker, sql).write('b', written({ keys: [run(1)] }), 5)
      expect(yield* waiting).toEqual([['r', [listedOf('b')]]])
      // The step that takes the entity out of its suspension deletes every wait, and a later suspension lists none.
      yield* store.write('r', written({ handled: 1, woken: true }), 6)
      yield* store.write('r', written({ queued: [inbound('two')], suspension: onMessage }), 7)
      expect(yield* waiting).toEqual([['r', []]])
      const [left] = yield* sql<{ held: number }>`SELECT COUNT(*) AS held FROM effecttea_waiting`
      expect(Number(left?.held)).toBe(0)
    }).pipe(Effect.orDie)))

/**
 * The readings of the read model over rows that fast-check generates. Each property holds whatever the rows hold,
 * so none of them repeats the order of the kinds that the tests above write out.
 */
describe('readings over generated rows', () => {
  /** Text a database holds: no U+0000 and no lone surrogate, which a row never holds (decisions 0157, 0206). */
  const text = fc.string({ unit: fc.constantFrom('a', 'b', 'B', 'é', 'ß', '😀', '0', ' '), maxLength: 3 })
  const id = fc.string({ unit: fc.constantFrom('a', 'b', 'B', 'é', '😀', '0'), minLength: 1, maxLength: 3 })
  const number = fc.oneof(fc.integer({ min: -2, max: 2 }), fc.double({ noNaN: true, noDefaultInfinity: true }))
  const rank: fc.Arbitrary<Scalar | undefined> = fc.oneof(
    fc.constant(null),
    fc.constant(undefined),
    fc.boolean(),
    number,
    text,
  )
  const rows = fc.uniqueArray(fc.tuple(id, rank), { selector: ([id]) => id, maxLength: 12 })
  const comparison = fc.constantFrom<Comparison>('=', '<>', '<', '<=', '>', '>=')
  const criterion = fc.record({ is: comparison, value: rank })
    .map(({ is, value }) => ({ index: 'rank' as const, is, value: value ?? null }))
  const where = fc.array(criterion, { maxLength: 2 })

  type Store = ReturnType<typeof storage<Ranked>>

  const write = (store: Store, entries: ReadonlyArray<readonly [string, Scalar | undefined]>) =>
    Effect.forEach(entries, ([id, rank]) =>
      store.write(
        id,
        created({ shown: { projection: JSON.stringify(rank ?? null), indexes: rank === undefined ? {} : { rank } } }),
        0,
      ))

  /** Runs `body` on values `arbitrary` draws, after the `examples` given, which every run runs. */
  const property = <A>(
    arbitrary: fc.Arbitrary<A>,
    body: (store: Store, value: A) => Effect.Effect<void>,
    examples: ReadonlyArray<A> = [],
  ) =>
    fc.assert(
      fc.asyncProperty(arbitrary, (value) => database((sql) => body(storage(ranked, sql), value))),
      { numRuns: Bun.env['SCHEDULES'] === 'all' ? 200 : 8, examples: examples.map((example) => [example]) },
    )

  test('the pages of a query, read one after the other, give the query read at once, in either order', () =>
    property(
      fc.tuple(rows, where, fc.option(fc.boolean(), { nil: undefined }), fc.integer({ min: 1, max: 4 })),
      (store, [entries, where, descending, limit]) =>
        Effect.gen(function*() {
          yield* write(store, entries)
          const order = descending === undefined ? {} : { order: { index: 'rank' as const, descending } }
          const whole = yield* store.query({ where, ...order, limit: all })
          const pages: Array<Found<Ranked>> = []
          let after: Found<Ranked> | undefined
          do {
            const page = yield* store.query({ where, ...order, limit, after })
            expect(page.length).toBeLessThanOrEqual(limit)
            pages.push(...page)
            after = page.at(-1)
          } while (after !== undefined && pages.length <= entries.length)
          expect(pages).toEqual([...whole])
          if (descending !== undefined) {
            const other = yield* store.query({ where, order: { index: 'rank', descending: !descending }, limit: all })
            expect(other).toEqual([...whole].reverse())
          }
        }),
    ), 120_000)

  test('a criterion that orders finds a prefix or a suffix of the rows that hold a value, in the order of a query', () =>
    property(fc.tuple(rows, criterion), (store, [entries, { is, value }]) =>
      Effect.gen(function*() {
        yield* write(store, entries)
        const ids = (where: ReadonlyArray<Criterion<Ranked>>) =>
          Effect.map(store.query({ where, order: { index: 'rank' }, limit: all }), (rows) => rows.map(({ id }) => id))
        const every = yield* ids([])
        const held = yield* ids([{ index: 'rank', is: '<>', value: null }])
        const found = yield* ids([{ index: 'rank', is, value }])
        // Against null, `=` and `<>` ask whether a row holds a value, and an order finds nothing.
        if (value === null) {
          expect(found).toEqual(is === '=' ? every.filter((id) => !held.includes(id)) : is === '<>' ? held : [])
          return
        }
        if (is === '<' || is === '<=') expect(found).toEqual(held.slice(0, found.length))
        if (is === '>' || is === '>=') expect(found).toEqual(held.slice(held.length - found.length))
        const both = (left: Comparison, right: Comparison) =>
          Effect.map(
            Effect.all([ids([{ index: 'rank', is: left, value }]), ids([{ index: 'rank', is: right, value }])]),
            ([left, right]) => [...left, ...right].sort(),
          )
        // The comparisons split the rows that hold a value as an order splits them.
        const sorted = [...held].sort()
        expect(yield* both('<', '>=')).toEqual(sorted)
        expect(yield* both('<=', '>')).toEqual(sorted)
        expect(yield* both('=', '<>')).toEqual(sorted)
      })), 120_000)

  test('numbers are ordered as numbers and text by its bytes of UTF-8, the id breaking ties', () =>
    property(
      fc.oneof(
        fc.uniqueArray(fc.tuple(id, number), { selector: ([id]) => id, maxLength: 10 }),
        fc.uniqueArray(fc.tuple(id, text), { selector: ([id]) => id, maxLength: 10 }),
      ),
      (store, entries) =>
        Effect.gen(function*() {
          yield* write(store, entries)
          const bytes = (left: string, right: string) => Buffer.compare(Buffer.from(left), Buffer.from(right))
          const compare = (left: Scalar, right: Scalar) =>
            typeof left === 'number' && typeof right === 'number' ? left - right : bytes(String(left), String(right))
          const expected = [...entries]
            .sort(([a, left], [b, right]) => compare(left, right) || bytes(a, b))
            .map(([id]) => id)
          const found = yield* store.query({ order: { index: 'rank' }, limit: all })
          expect(found.map(({ id }) => id)).toEqual(expected)
        }),
    ), 120_000)
})
