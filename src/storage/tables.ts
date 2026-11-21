/**
 * The tables of the storage, and what holds of a database whatever program runs on it: the dialects the storage
 * speaks, the transaction of the runtime, and the migrations that make every table.
 */
import * as Effect from 'effect/Effect'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'
import { Migrator, SqlClient, type SqlError } from 'effect/sql'
import { InvariantDefect } from '../program.ts'
import { Count } from './rows.ts'

/** The dialects the storage speaks (decision 0157). */
export type Dialect = 'sqlite' | 'pg'

/** The client's dialect. One the storage does not speak is the launcher's defect, and is named (decision 0157). */
export const dialectOf = (sql: SqlClient.SqlClient): Dialect => {
  const dialect = sql.onDialect({
    sqlite: () => 'sqlite',
    pg: () => 'pg',
    mysql: () => 'mysql',
    mssql: () => 'mssql',
    clickhouse: () => 'clickhouse',
  })
  if (dialect === 'sqlite' || dialect === 'pg') return dialect
  throw new InvariantDefect({ reason: `the storage speaks SQLite and PostgreSQL, and the client speaks ${dialect}` })
}

/**
 * Runs `effect` in a transaction of the runtime's, begun by `onSqlite` on SQLite where it is given. On PostgreSQL the
 * transaction begins at `READ COMMITTED` whatever level the role or the database sets by default. A step's first
 * statement waits for the lock of its entity, and at this level each statement after it reads what the transaction
 * that held the lock committed. At a higher level the step would read the snapshot taken before it waited, and its
 * write over a row the other transaction wrote would fail with `SerializationError`. A reading of one snapshot begins
 * its own transaction at `REPEATABLE READ` instead.
 */
export const transaction = <A, E, R>(
  sql: SqlClient.SqlClient,
  effect: Effect.Effect<A, E, R>,
  onSqlite?: string,
): Effect.Effect<A, E | SqlError.SqlError, R> => {
  const begin = dialectOf(sql) === 'pg' ? 'BEGIN ISOLATION LEVEL READ COMMITTED' : onSqlite
  const run = sql.withTransaction(effect)
  return begin === undefined ? run : Effect.provideService(run, SqlClient.BeginTransaction, begin)
}

/**
 * The tables, made by the migrations not yet recorded in `effecttea_migrations`. Every entity of every program sits in
 * them: the name of the program and the id are the entity's address (decision 0022). Every table, index, trigger and
 * function the runtime makes is named with `effecttea_`, so that the tables of an application in the same database are
 * never taken for its own. The first migration creates each object without `IF NOT EXISTS`, so that a launch on a
 * database that already holds an object under one of those names dies, and leaves none of its own (decision 0218).
 * `Migrator` runs the pending migrations in one transaction, so that two
 * launches on one database run each migration once (decision 0216). On SQLite the transaction takes the file's write
 * lock as it begins, which the driver does by default and this asks for by name, since a transaction begun without
 * it dies while another runs; on PostgreSQL `Migrator` locks its table.
 *
 * Dies within a transaction of its client, and makes nothing. Within one, the migrations' transaction would be a
 * savepoint, which begins after the caller's snapshot and does not take SQLite's write lock (decision 0279).
 */
export const createTables: Effect.Effect<void, never, SqlClient.SqlClient> = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  if (Option.isSome(yield* Effect.serviceOption(sql.transactionService))) {
    const reason = 'createTables runs within a transaction of its client: run it on the client outside any transaction'
    return yield* Effect.die(new InvariantDefect({ reason }))
  }
  yield* migrate
})

/**
 * The migrations of `createTables`, run on the transaction they are given. Only tests call it so, where a
 * `SET LOCAL` of a caller's transaction gives the migrations a `search_path` (decision 0279).
 */
export const migrate: Effect.Effect<void, never, SqlClient.SqlClient> = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const dialect = dialectOf(sql)
  // `Migrator` looks for its table in every schema of the `search_path`, and would take the history of a schema
  // further on it for this one's. Named in the schema the tables are made in, it finds only this one's
  // (decision 0217). Without a schema to make them in, the creation fails as it would unnamed.
  const schema = dialect === 'pg' ? yield* firstSchema(sql) : null
  const migrated = Migrator.make({})({
    loader: Migrator.fromRecord(migrations),
    table: migrationsTable(schema),
  })
  yield* dialect === 'sqlite'
    ? Effect.provideService(migrated, SqlClient.BeginTransaction, 'BEGIN IMMEDIATE')
    : migrated
}).pipe(Effect.orDie)

/**
 * The schema the tables are made in on PostgreSQL, the first of the `search_path` that exists, or null for none
 * (decision 0215). Dies where `effecttea_migrations` is found in a schema further on the `search_path`, since
 * the tables are then in that schema, and a launch would make a set of empty tables in the first (decision 0263).
 */
const firstSchema = (sql: SqlClient.SqlClient) =>
  Effect.gen(function*() {
    const [found] = yield* sql<{ first: string | null; holder: string | null }>`
      SELECT current_schema() AS first,
        (SELECT nspname FROM pg_class JOIN pg_namespace ON pg_namespace.oid = relnamespace
         WHERE pg_class.oid = to_regclass('effecttea_migrations')) AS holder
    `
    const first = found?.first ?? null
    const holder = found?.holder ?? null
    if (holder !== null && holder !== first) {
      const reason = `the tables are in the schema '${holder}', and the search_path names '${first}' before it, ` +
        `where a launch would make tables of its own: set the role's search_path to the schema that holds the ` +
        `tables, or move the tables into '${first}'`
      return yield* Effect.die(new InvariantDefect({ reason }))
    }
    return first
  })

/** `effecttea_migrations`, named in the schema the tables are made in, where there is one (decision 0217). */
const migrationsTable = (schema: string | null) =>
  schema === null ? 'effecttea_migrations' : `${schema}.effecttea_migrations`

/**
 * Dies unless the tables were made by the migrations `createTables` runs, every one and no other: `check` reads the
 * tables a launch of this release would read, and makes none (decision 0247).
 */
export const tablesMade: Effect.Effect<void, never, SqlClient.SqlClient> = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const schema = dialectOf(sql) === 'pg' ? yield* firstSchema(sql) : null
  const recorded = yield* Effect.flatMap(
    sql`SELECT migration_id, name FROM ${sql(migrationsTable(schema))} ORDER BY migration_id`,
    Schema.decodeUnknownEffect(Schema.Array(Schema.Struct({ migration_id: Count, name: Schema.String }))),
  )
  const held = recorded.map(({ migration_id, name }) => `${String(migration_id).padStart(4, '0')}_${name}`)
  const made = Object.keys(migrations)
  if (held.join(',') !== made.join(',')) {
    const reason = `the tables are made by the migrations [${held.join(', ')}], and this release reads those of [${
      made.join(', ')
    }]`
    return yield* Effect.die(new InvariantDefect({ reason }))
  }
}).pipe(Effect.orDie)

// The schema of the first release. A later change of a table is a migration of its own, after this one.
const tables = Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient
  const dialect = dialectOf(sql)
  // An integer of SQLite holds 64 bits, and one of PostgreSQL 32: a time, a `seq` and a count are bigints there
  // (decision 0157).
  const integer = sql.literal(dialect === 'pg' ? 'BIGINT' : 'INTEGER')
  // Text of PostgreSQL is compared by its bytes, as SQLite compares it, so that ids are ordered alike in both
  // dialects (decision 0157).
  const text = sql.literal(dialect === 'pg' ? 'TEXT COLLATE "C"' : 'TEXT')
  // The state, the request that created the entity with its flags, and the suspension: one row per entity. A
  // caller's retry of the creation is compared with the flags (decision 0269). `suspended_at` is the
  // time the entity suspended, kept while it stays suspended, which an operator reads (decision 0114).
  // `incarnations` is the last incarnation the entity drew, which never goes back (decision 0132). `steps` counts
  // the entity's writes, its creation the first, and numbers its rows of the outbox.
  yield* sql`
    CREATE TABLE effecttea_entities (
      name ${text} NOT NULL,
      id ${text} NOT NULL,
      state ${text} NOT NULL,
      version ${integer} NOT NULL,
      creation ${text} NOT NULL,
      flags ${text} NOT NULL,
      incarnations ${integer} NOT NULL,
      suspended_on ${text},
      suspended_cause ${text},
      suspended_at ${integer},
      steps ${integer} NOT NULL DEFAULT 0,
      PRIMARY KEY (name, id)
    )
  `
  // One row per key the state holds work under, with its incarnation. A key whose work is gone has no row, since
  // the entity's counter keeps its incarnations from going back (decision 0132). `due` is a timer's time, by which
  // an entity nothing else holds loaded is woken (decision 0029). `key` is the key's name and `parameter` the JSON
  // of its parameter, or '' for a key without one: no JSON is empty, and a NULL in a primary key would let two rows
  // of one key coexist (decision 0136).
  yield* sql`
    CREATE TABLE effecttea_entity_keys (
      name ${text} NOT NULL,
      id ${text} NOT NULL,
      key ${text} NOT NULL,
      parameter ${text} NOT NULL,
      incarnation ${integer} NOT NULL,
      version ${integer} NOT NULL,
      work ${text} NOT NULL,
      delivery ${text},
      due ${integer},
      PRIMARY KEY (name, id, key, parameter)
    )
  `
  yield* sql`CREATE INDEX effecttea_entity_keys_due ON effecttea_entity_keys (due)`
  // The mailbox, in order: `seq` is given as a message is queued, and the first message is the lowest. `keep` is
  // how long a caller's reply is kept once its message is answered, null for ever (decision 0125). An internal
  // message holds the key of its work as `effecttea_entity_keys` does (decision 0136).
  yield* sql`
    CREATE TABLE effecttea_mailbox (
      name ${text} NOT NULL,
      id ${text} NOT NULL,
      seq ${integer} NOT NULL,
      tag ${text} NOT NULL,
      version ${integer} NOT NULL,
      message ${text} NOT NULL,
      request ${text},
      keep ${integer},
      key ${text},
      parameter ${text},
      incarnation ${integer},
      PRIMARY KEY (name, id, seq)
    )
  `
  // What callers read of each entity, and the values of the program's indexes on it: the read model of a
  // query across entities, written in the step's transaction (decision 0032).
  yield* sql`
    CREATE TABLE effecttea_projections (
      name ${text} NOT NULL,
      id ${text} NOT NULL,
      projection ${text} NOT NULL,
      indexes ${text} NOT NULL,
      version ${integer} NOT NULL,
      PRIMARY KEY (name, id)
    )
  `
  // What other systems learn of the entities of a program deployed with the outbox: a row for its creation, and one
  // for each step whose projection changed, written in the step's own transaction. `step` is the entity's `steps`
  // after the step, so an entity's rows are in the order of its steps, and no order holds across entities. `kind` is
  // `Creation`, `Inbound` or `Internal`, and `message` is null for a creation. The library never deletes a row: a
  // reader deletes by key the rows it handled.
  yield* sql`
    CREATE TABLE effecttea_outbox (
      name ${text} NOT NULL,
      id ${text} NOT NULL,
      step ${integer} NOT NULL,
      kind ${text} NOT NULL,
      version ${integer} NOT NULL,
      written_at ${integer} NOT NULL,
      message ${text},
      projection ${text} NOT NULL,
      PRIMARY KEY (name, id, step)
    )
  `
  // The replies, by request: a retry gets the one stored (decision 0015). The request is its JSON as the machine
  // keys it, read through its schema (decision 0059). A row is keyed by the version that wrote it too, since a
  // migration may give one caller's request the text another's had: two versions never share a row
  // (decision 0069). A reply to another entity's operation holds the work that asked, its program, id, key and
  // incarnation, and is deleted once that work no longer holds (decision 0021). The key is held as
  // `effecttea_entity_keys` holds it (decision 0136). A caller's reply with an `until` is read before that time only
  // (decision 0125).
  // `request_id` is the id of a caller's request, null for another's, written by the process: PostgreSQL parses no
  // JSON that holds U+0000, which the program's data may (decision 0157). `carried` is the message a caller's request
  // carried, which a retry is compared with, and null for another's (decision 0269).
  yield* sql`
    CREATE TABLE effecttea_replies (
      name ${text} NOT NULL,
      id ${text} NOT NULL,
      request ${text} NOT NULL,
      request_id ${text},
      carried ${text},
      tag ${text} NOT NULL,
      version ${integer} NOT NULL,
      reason ${text},
      until ${integer},
      sender_name ${text},
      sender_id ${text},
      sender_key ${text},
      sender_parameter ${text},
      sender_incarnation ${integer},
      PRIMARY KEY (name, id, request, version)
    )
  `
  yield* sql`CREATE INDEX effecttea_replies_sender ON effecttea_replies (sender_name, sender_id)`
  yield* sql`CREATE INDEX effecttea_replies_until ON effecttea_replies (name, until) WHERE until IS NOT NULL`
  // A caller's request a version before stored is found by its request id: its sender may be migrated since
  // (decision 0065).
  yield* sql`
    CREATE INDEX effecttea_replies_by_request_id ON effecttea_replies (name, id, request_id) WHERE request_id IS NOT NULL
  `
  // The answers another entity's operation was given that no entity stores: a creation `init` rejected, and a
  // message to no entity. Each is kept under the receiver and the request while the work
  // that asked holds, so that a run after a crash is given it again (decision 0253). `kind` tells a creation's answer
  // from a message's, which an operation may send under the same name.
  yield* sql`
    CREATE TABLE effecttea_answers (
      name ${text} NOT NULL,
      id ${text} NOT NULL,
      request ${text} NOT NULL,
      kind ${text} NOT NULL,
      tag ${text} NOT NULL,
      version ${integer} NOT NULL,
      reason ${text},
      sender_name ${text} NOT NULL,
      sender_id ${text} NOT NULL,
      sender_key ${text} NOT NULL,
      sender_parameter ${text} NOT NULL,
      sender_incarnation ${integer} NOT NULL,
      PRIMARY KEY (name, id, request, kind)
    )
  `
  yield* sql`CREATE INDEX effecttea_answers_sender ON effecttea_answers (sender_name, sender_id)`
  // The operations a suspended entity answered `Suspended`, by their run and the name each sent under, written by
  // the step that answered. The step that takes the entity out of its suspension deletes them (decision 0265).
  yield* sql`
    CREATE TABLE effecttea_waiting (
      name ${text} NOT NULL,
      id ${text} NOT NULL,
      sender_name ${text} NOT NULL,
      sender_id ${text} NOT NULL,
      sender_key ${text} NOT NULL,
      sender_parameter ${text} NOT NULL,
      sender_incarnation ${integer} NOT NULL,
      request ${text} NOT NULL,
      PRIMARY KEY (name, id, sender_name, sender_id, sender_key, sender_parameter, sender_incarnation, request)
    )
  `
})

/** The migrations that make the tables, each by the name `Migrator` records it under. */
const migrations = { '0001_tables': tables }
