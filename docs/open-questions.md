# Open questions

This file holds what is not decided on the code since the restart of 2026-11-21. Each question names the code it
rests on as it stands now, and says what would decide it: a test, a step of the [roadmap](roadmap.md), a release of a
dependency, or a program with a requirement that no example has yet. A question leaves this file when a test, a
sentence of [`design.md`](design.md) or a step of the roadmap decides it.

## For the owner

What only the owner decides, as [`AGENTS.md`](../AGENTS.md) lists under Deciding. A question gives the agent's choice
first, what each answer changes for a user of the library, and whether it can be undone. It names the step of the
roadmap that waits for it. No question waits today.

## Storage and reading

- **An array with an own property besides its indices.** `isJson` of `src/program.ts` reads only the indices of an
  array, and `JSON.stringify` drops any other own property. So what is stored would differ from what the schema
  encoded. Only a schema whose encoding gives such an array reaches the case, and none was tried.
  - A test of `src/program.test.ts` that gives `isJson` such an array would decide it.
- **A state written back to the text `reindex` read, at the version it read.** `reindex` of
  `src/storage/projections.ts` writes a row only where the stored state and version are those it computed from. A
  step that changes a state and a step that changes it back both land between the reading and the writing. `reindex`
  then writes its row, which is the projection of that same text by the program deployed. This holds while a
  projection is a function of the state alone. The tests of `src/storage.test.ts` skip an entity whose state moved or
  whose version changed, and no test runs the two steps that come back.
  - A test that runs two such steps between the reading of `reindex` and its write, and reads the row after, would
    decide it.
- **The order of the fields of a projection.** `canonical` of `src/machine.ts` sorts the fields of every object, and a
  step compares the canonical text of its projection with the one before to decide whether it writes a row of the
  outbox. The columns are `TEXT` on both dialects, so PostgreSQL does not reorder what it holds. The test
  `an operation is the same whatever the order its schema writes its fields in`, of `src/machine.test.ts`, holds the
  order for work, and no test holds it for a projection.
  - A test of a step whose projection differs from the one before only in the order of its fields, which expects no
    row of the outbox, would decide it.
- **A query that pages across `reindex`.** A row no step changes is given once, on one page. `reindex` writes the rows
  of a program again with no step, after a deploy that changed an index, so a caller that pages across it may be
  given a row twice or not at all.
  - Whether the guide says that a query paged across such a deploy may repeat or skip a row, or a test that pages
    across `reindex` and counts the rows given, would decide it.
- **The indexes of a row of the read model read without their schema.** `storedIndexes` of
  `src/storage/projections.ts` reads a row's `indexes` with `JSON.parse` and a cast. A row whose `indexes` is JSON
  but no object, as `null`, fails a query with a `TypeError`, a defect that names no table.
  - A test of `src/storage.test.ts` with a row of `indexes` written by hand as `null` or as an array would decide it,
    and a reading through a schema of `src/storage/rows.ts` would fix it.
- **A reading on SQLite that waits for another runtime's write lock.** A runtime holds no database, and another may
  run on the same file. `query`, `inspect`, `suspended` and the readings of `check` run in `snapshot` of
  `src/storage/held.ts`, a transaction. A transaction of a writable `SqliteClient` takes the write lock for its
  length, though it only reads, as the client's JSDoc says. So a reading that waits past the busy timeout of 5 s for
  the other runtime's transaction dies with `SQLITE_BUSY`, as a defect.
  - A test of two runtimes on one file, one of which holds a step at its commit by `probe` while the other reads a
    page, would decide it.
- **Two runtimes of one process on one file of SQLite.** Each `launch` runs `createTables`, which begins with
  `BEGIN IMMEDIATE`, and each step does too. Under bun:sqlite the call is synchronous, so a second client's
  `BEGIN IMMEDIATE` blocks the event loop for the busy timeout while the first client holds the write lock, and the
  first cannot reach its commit meanwhile. `src/runtime.processes.test.ts` runs its two runtimes in two processes,
  and the spike `spikes/migrator-two-runs-at-once.test.ts` runs its second run in a child process.
  - A test that launches two runtimes at once in one process on a file with no tables, and times the second, would
    decide it.
- **A `PgClient` given `transformQueryNames`.** The function would change the name `effecttea_migrations` where
  `Migrator` names it as an identifier, and so the name of the table made. It would not change the name in the SQL
  text of `tablesMade` and of `onFirstSchema`, in `src/storage/tables.ts`, which write the name as text. So
  `tablesMade` would read a table other than the one made, and `onFirstSchema` would look for that other table too.
  - Whether a launch refuses a client given `transformQueryNames`, or a test of `src/storage.test.ts` on PGlite with
    such a client, would decide it.
- **A set of tables the `search_path` no longer names.** `onFirstSchema` of `src/storage/tables.ts` dies where a schema
  further on the `search_path` holds the tables. A launch whose `search_path` no longer names the schema that holds
  them, as `runtime` alone where the tables are in `public`, finds no history and makes an empty set of tables, with
  no error. It would be decided by:
  - whether a launch dies where any schema of the database but the first holds `effecttea_migrations`, and what that
    costs an operator who keeps a copy of the tables in another schema;
  - a test of `src/storage.test.ts` on PGlite of the case.
- **A connection of a pool whose `search_path` is another.** `onFirstSchema` reads one connection, and `Migrator` runs
  its transaction on the connection the pool gives it next. A connection whose `search_path` a `SET` of a session or
  a pooler changed is not seen by the check. The tests of `src/postgres.test.ts` set the `search_path` of the role,
  which every connection shares. It would be decided by:
  - whether the check runs inside the transaction of `Migrator`, which gives no hook for it at the version pinned;
  - a test of `src/postgres.test.ts` on the CI's server, with one connection of the pool given another `search_path`.
- **Generated cases of a migration.** A case of a migration is recorded by hand, with the JSON a version wrote and the
  JSON the next one reads, and `src/testing.ts` checks the cases. A changed migration that keeps every recorded case
  is not seen. That a row of an older version is still read at the program's version needs no recorded reading. A
  generated value of the older version, migrated and decoded, must not die. But an arbitrary of an older version's
  JSON is a shape of that version kept in the tests for as long as the migration. It waits for a program whose
  migrations a change could break unseen. It would be decided by:
  - a program with a migration of many branches, whose recorded cases a change could keep while it reads other rows
    otherwise;
  - what an arbitrary of an older version costs to keep, next to the cases recorded of it.
- **A caller that follows a projection.** A caller learns that an entity changed only by reading its projection
  again, since `read` answers once. A program of effect-tea in a browser would follow an entity, and send to it with a
  command that retries under the same request id while the entity answers `Suspended`. Step 14 of the
  [roadmap](roadmap.md) decides how a caller waits for a projection past the step it last read. What is left is
  whether the library ships the client of such a browser, a module that depends on both libraries. It would be decided
  by:
  - what a caller that reconnects reads first, so that it misses no change between its last reading and the next;
  - how much of the screen of `examples/seat` a second program would write again.
- **A record of every step.** The outbox writes a row only for a creation and a step that changes the projection, as
  `src/runtime.outbox.test.ts` checks. A message that is rejected writes no row, and neither does a message that
  changes the state and leaves the projection as it was. A rejection is not lost to the application, since its sender
  is answered `Rejected`. A fact of the state that must reach other systems is shown in the projection. What no
  application can make up for later is the past. A program deployed without the outbox writes no row, and a reader
  deletes the rows it handled, so a new read model cannot be built from the steps before it. Event sourcing keeps
  every step by construction. It waits for a program that needs a read model of a past it did not publish. It would
  be decided by:
  - a program whose new read model must hold steps that no row of the outbox holds;
  - whether such a record is the outbox written at every step, or a table of its own;
  - what the record costs a step: a row more in each transaction, and the message stored for every step.
- **A reading of one snapshot beside a step, on a pool of PostgreSQL.** `inspect`, `suspended` and each entity of
  `check` read their rows in `snapshot` of `src/storage/held.ts`, which begins at `REPEATABLE READ` on PostgreSQL, so
  that a step that commits meanwhile is read whole or not at all. A page of `query` beside a step is tested on the
  CI's server, in `src/postgres.test.ts`, and no test runs those three readings beside a step on a server.
  - A test of `src/postgres.test.ts` that holds a step between two of its statements while `inspect` reads the
    entity, and finds the step read whole or not at all, would decide it.
- **Orders of the storage no test holds.** Three premises of the read model rest on an order of the code that no test
  fails without. A step writes its entity's row before its projection, and `reindex` locks the entity's row with
  `FOR UPDATE` before it writes the projection, so the two close no cycle of locks. Every event writes its row of the
  read model in the same transaction, and a caller is answered only once its step has committed, so a read after the
  answer finds the row. And `reindex` passes over an entity whose projection's encoding dies, as it passes over one
  whose state or index dies, which `src/storage.test.ts` tests. It would be decided by:
  - a test of `src/postgres.test.ts` that holds a step after the update of its entity's row while `reindex` runs;
  - a test that checks after each history that every row of the read model is the projection of the stored state,
    and a test that reads after an answer while the commit is held;
  - a test of `src/storage.test.ts` whose projection's schema refuses to encode a state.
- **An index a program no longer declares.** `indexed` of `src/storage/projections.ts` makes an index of
  `effecttea_projections` for each index a program declares, and an index the program drops is left. The comment of
  `indexed` in `src/storage.ts` says that the index left costs nothing. Each index is over every row of the table,
  with no `WHERE`, so every write of a projection, of any program, still keeps it. It costs writes and room, and
  changes no answer.
  - A reading of the cost on each dialect, and a comment or a drop of the index that follows it, would settle it.
- **The name of a long index after a release whose `Hash.string` differs.** On PostgreSQL a name of an index longer
  than 63 bytes ends with `Hash.string` of the whole name, in `indexName` of `src/storage/projections.ts`. A release of
  Effect whose `Hash.string` differs would name the same index otherwise, and the next deploy would make it again.
  No test reaches it yet. It would be decided by:
  - what a deploy does when the index it would keep has a name of another hash;
  - whether the name takes a hash the library computes itself.
- **A check under a role of rows alone.** `check` reads `effecttea_migrations` through `tablesMade` of
  `src/storage/tables.ts`. `spikes/pglite-role-without-ddl.test.ts` runs `createTables` and a runtime under a role
  that may only read and write rows, and does not run `check`.
  - A case of that spike that runs `check` would decide it.

## Running

- **An operation's fiber interrupted before its first step.** `apart` of `src/runtime.ts` forks `operating` with
  `Effect.forkIn`, and the fiber starts when the scheduler says. `operating` forgets its run in an `ensuring`, and an
  `ensuring` runs only once its effect has started. So a fiber that the process's scope interrupts before its first
  step leaves its entry in `operations`, and tells no change. The other interruption of such a fiber, a step that
  drops a droppable operation, takes the entry out first. Nothing reads `operations` once the scope has closed, so no
  rule is broken today. It would be decided by:
  - a test under the scheduler of `src/testing.ts` that closes the scope between the fork and the fiber's first step,
    then reads what `settled` waits on;
  - whether a fork through `FiberSet.run`, which starts its fiber at once, would hold the release instead, given that
    it keeps the transaction of the forking fiber, which `untransacted` takes out.
- **A stored `due` before the time the entity's work holds.** `due` of `src/storage/entities.ts` compares `due` in
  SQL and reads the id alone. The waker of `src/runtime.ts` then fires the timer that `Machine.nextTimer` finds in
  the stored work, which has none due where `work` holds a later time. So nothing fires, and the waker reads the entity
  again after each `retry` until the time in `work`, with nothing logged. Only a row written by hand reaches it.
  - A test of `src/runtime.test.ts` that writes such a `due` and counts the waker's readings would decide it.
- **A retry stepped past its reply's `keep`.** A caller's reply is kept for `keep` from the step that answers, and a
  retry whose step reads the reply past its time is a new message. A retry sent before the answer waits for the lock
  of its entity behind the first step, and its transaction reads the time after the lock, so under a `keep` of 0 it
  applies the message again. The same holds under a `keep` above 0 behind a slow step, and of a caller answered
  `Suspended` that sends again while an operator resumes the entity. No test runs either case. It would be decided
  by:
  - a test that holds the first step at its commit by `probe`, moves `TestClock` past the `keep`, and counts what
    the entity applied;
  - whether the guide tells a boundary that a `keep` covers the retries it sends after the answer alone.
- **A boundary's clock against the runtime's, for a reply's `keep`.** A caller's reply is kept for the window its
  boundary gives, counted on the runtime's clock alone. A boundary counts its protocol's retries on its own clock, so
  a skew between the two clocks shortens or lengthens the window by that skew. A window shortened past a retry applies
  its message twice. It would be decided by:
  - a rule of the guide that a boundary adds the skew it allows to its `keep`;
  - or a measure of the skew between the hosts of a boundary and of a runtime that the library supports.
- **A runtime under a clock moved by less than a millisecond.** The runtime reads its time from `DateTime.now`, and
  the live clock gives `Date.now()`, which is whole. `TestClock.adjust` adds its duration unrounded, and the JSDoc of
  `Clock` promises no integer. So a runtime under a `TestClock` moved by `Duration.micros(1500n)` hands the machine a
  time between two milliseconds. A timer armed from it is a defect of `checkWork` in `src/machine.ts`, where a
  rehearsal moves by whole milliseconds alone. It would be decided by:
  - a test of the runtime under `TestClock.adjust(Duration.micros(1500n))` that arms a timer from the time of a
    message;
  - a guard that floors the time where `inEntity` reads it, or refuses a clock that is not whole.
- **A message and a sender given to `update` as sent, or decoded from their JSON.** `send` of `src/runtime.ts` gives
  the machine a caller's message and sender as the caller sent them, and the mailbox handled in the same transaction
  holds them so. A message left in the mailbox by a crash is decoded from its row by `load` of
  `src/storage/entities.ts`. So `update` may be given `-0` at once and `0` after a crash, for the same message. A
  schema whose decoding is not the inverse of its encoding gives two values that differ more. It would be decided by:
  - a test that sends a message holding `-0`, once handled at once and once after a crash, and compares what `update`
    is given;
  - whether the runtime gives `update` the message decoded from what it stores, at the cost of a decoding for each
    message.
- **Two versions of a program, or two releases of the library, on one database at once.** A runtime holds no
  database, so a rolling deploy runs an older and a newer runtime on one database. `up` of `src/storage/held.ts` has
  no migration from a version newer than the program's, so the older runtime cannot read an entity the newer one
  stepped. A deploy that changes `update`, an index or `work` and adds no migration keeps its version, so two codes of
  one version step the same entities, and a query by a new index misses the rows the older code wrote. An older
  release of the library steps on tables a newer release migrated, since `tablesMade` makes `check` die there and a
  launch does not. No test runs two versions at once. It would be decided by:
  - whether `docs/design.md` excludes two versions at once on one database, or says what each runtime does;
  - a test of two runtimes of two versions on one file, of what the older one does at an entity the newer stepped;
  - whether a launch records a digest of what a program writes beside its version;
  - step 10 of the [roadmap](roadmap.md), which lists what a deploy may change.
- **An operation's kept answer under two runs at once.** An answer no entity stores, a creation rejected or a
  `NotFound`, is kept for the operation that was given it, and a run after a crash is given it again. `send` and
  `create` of `src/runtime.ts` read the kept answer before they take the receiver's lock. Each runtime on a database
  restarts the operations of the other, so two runs of one incarnation may run at once. The second may then read no
  answer before the first keeps one, and act on another answer. It would be decided by:
  - whether two runs at once may act on different answers, as they may act twice on any answer;
  - or whether the answer is read and kept under the receiver's lock, and a test of two runtimes that holds it.
- **A failure of the storage that passes.** Every call of a handle turns a `SqlError` into a defect, with
  `Effect.orDie` in `inEntity` and in the storage, so a connection that drops for a second reaches a caller as a
  defect, the same as a bug. The runtime retries in the database only the end of an operation, by `persisting`, and an
  operation's send, by `answered`. A boundary that would retry such a failure must catch every defect to find it, and
  the type of `send`, `Effect<Answer>`, says nothing of it. It waits for the release, since it changes the signature of
  each call. It would be decided by:
  - which failures of `SqlError` are transient on each dialect, a lost connection or a serialization failure, and
    which are not, a full disk or a missing table;
  - whether a retry inside the runtime keeps the rule that a step is one transaction, applied once, when the commit's
    answer is lost and the commit is not.
- **A statement whose condition PostgreSQL reads from its snapshot.** At `READ COMMITTED`, PostgreSQL reads a row a
  concurrent transaction updated again against the outer `WHERE` of an `UPDATE` or a `DELETE`, and a subquery's rows
  stay those of the statement's snapshot. The storage locks the rows a statement reads its condition from, by
  `lockingTheCondition` and `lockingTheConditionSkipping` of `src/storage/held.ts`. The pool's tests hold `expire`
  against a step, in `src/postgres.test.ts` and `src/runtime.pool.test.ts`, and none holds `reindex` against a step.
  It would be decided by:
  - a reading of every statement of `src/storage/` whose guard stands in a subquery or in an `INSERT … SELECT`;
  - a test of `reindex` against a step on the CI's server.
- **A droppable operation dropped, whose finalizer still acts.** A step that drops or changes a droppable operation
  forks its interruption, in `inEntity` of `src/runtime.ts`, and waits for none of its finalizers. A droppable
  operation acts on nothing and sends nothing, so nothing the library keeps is touched, and its late completion is
  offered under an incarnation no step draws again. A runner declared droppable that acts in its finalizer would act
  beside the next step. It would be decided by:
  - whether a runner may be declared droppable and act in its finalizer, which no type and no check refuses;
  - whether a step waits for the finalizers of the operations it drops, at the cost of a wait in its transaction.
- **An act on the outside world beside another runtime's run.** Each runtime on a database restarts the operations
  of the other, so an idempotent operation may run in two processes at once, and an at-most-once operation is recorded
  `unknown` while it still runs in the other, as `docs/design.md` says. The library cannot refuse what such a run does
  to a service. It would be decided by:
  - whether an operation is given an epoch of its run, which a service downstream may use to refuse the older run, as
    it may use the idempotency key.
- **A wait whose operation, run again, sends elsewhere.** A step that answers an operation `Suspended` stores its
  wait, and `suspended` lists it while the run that sent holds, by `waitingOf` of `src/storage/entities.ts`. An
  operation run again after a crash keeps its incarnation, and may send to another entity than the first time, since
  what it sends is its own effect's. Its wait stays listed under the first receiver until that receiver's suspension
  ends. No test reaches the case yet. It would be decided by:
  - a test of the runtime whose operation sends to one entity, crashes, and sends to another once run again;
  - whether an operator is misled by such a wait, or reads it as the history of the run;
  - whether a run's wait could be dropped by the run's next send, at the cost of a write per send.
- **One primitive for a look that waits.** Two places of `src/runtime.ts` take a signal before they look, so that no
  change between the look and the wait is missed: `settled`, on `changed`, and `answered` in `entitiesOf`, on
  `resumed`. The waker takes a sliding queue, `poke`, that a step offers to. Each is written by hand. It would be
  decided by:
  - whether a module of Effect at the version pinned does the same, among the unstable ones too;
  - whether the three take their signal alike, or the waker's queue needs another form.

## Programs

- **When a deploy's new work starts on an entity that holds no operation.** A deploy activates the entities whose
  state holds an operation or whose mailbox holds a message, by `interrupted` of `src/storage/entities.ts`. Any other
  entity is activated by the program deployed at its next transaction, which a stored timer gives at its time. So an
  operation that a new version computes from a state that held only timers, or no work, starts late, or never on an
  entity no caller touches. The machine activates every entity at the deploy. The histories found it on 2026-11-21: a
  timer under `t` armed, then a deploy that makes `t` an operation, which does not run. The runtime's target of the
  histories, in `src/runtime.histories.test.ts`, retries the creation after each deploy, so the histories do not check
  it. Activating every entity with a stored timer at each deploy costs a transaction for each of them.
  - Step 10 of the [roadmap](roadmap.md), which lists what a deploy may change, decides it.
- **A deploy that changes a child's wrapper or the name of a key.** Bug 96 of [`bugs.md`](bugs.md) suspends an entity
  whose key's parameter a deploy encodes otherwise. A deploy that changes the form of a child's wrapper, or the name
  of a key with work under way, may fail the same way. Neither was run.
  - Step 10 of the [roadmap](roadmap.md) decides both, since its table names the children and the keys.
- **A rehearsal in a browser.** The machine computes the digest of an idempotency key with `createHash` of
  `node:crypto`, in `src/machine.ts`, so the machine runs only where that module is. `rehearse` and the runtime both
  run on Bun, which implements it, and no rehearsal in a browser is planned.
  - A requirement to rehearse a program in a browser would decide it, with a digest that the Web Crypto API
    computes, which is asynchronous.
- **A service that caps an idempotency key below 43 characters.** A runner of `IdempotentDigest` is given the digest
  of its key, 43 characters of unpadded base64url. Stripe caps a key at 255, and a service a program calls may cap it
  lower.
  - A service a user's program calls whose cap is lower than 43 would decide it, with a digest of fewer bits.
- **Two idempotency keys with one digest.** The digest of a key is its SHA-256, so two keys that share a digest would
  reach a service as one request. The 256 bits of SHA-256 leave the collision out.
  - A collision of SHA-256 found in public would decide it, with a move to another function.
- **An `Entities` a runner keeps from another run.** A droppable runner whose services hold `Entities` does not
  compile, and the runtime gives `Entities` only to a run of an operation. A runner can still keep an `Entities` of
  another run in a variable, which no type sees. `entitiesOf` of `src/runtime.ts` reads whether the run is droppable
  from the run that made the `Entities`, so a droppable runner that sends through a kept one would not die, and would
  send under the other run's key.
  - A test of a droppable runner that sends through an `Entities` kept in a variable would show what the runtime
    does, and whether the guide warns of it.
- **A deploy that adds a child named like an own tag still stored.** A child's name is never a parent's own tag, but
  the compiler sees one version alone. A version that adds a child named like an own message, reason or operation of
  the version before reads the rows that version stored. Its composed schema then takes a stored own value as the
  child's wrapper, or refuses it, and the entity fails to load. No test runs it. It would be decided by:
  - a test that stores an own message under one version and reads it under a version with a child of its tag;
  - step 10 of the [roadmap](roadmap.md), whose table would refuse the new version.
- **A retry that outlives the process.** A failure the provider may recover from is retried inside the runner, with
  `Effect.retry` and a schedule that ends, under the same key. A crash starts that schedule again from its first
  attempt, and an operation that waits between tries holds its fiber. A retry over hours or days is written in the
  state, as `examples/subscription` counts its attempts behind a timer. Whether the guide gives that form as a recipe,
  or the library a helper that writes it, is not decided. It waits for a second program that retries behind a timer.
  It would be decided by:
  - how much of `examples/subscription` a second program would write again, state and messages included;
  - whether a helper can add its attempts and its timer to a program's state and keys without hiding them from
    `update`, `work` and the rehearsal.
- **A rehearsal's crash and an operation that sends another message after it.** A run of an operation after a crash
  that sends another message under a name it used is given the first message's reply, and the receiver holds the
  first message alone. An operation that reports what it sent in its completion then says what the receiver does not
  hold, with nothing reported. A rehearsal runs the operation again at a crash, so a test is where this is found at the
  least cost. A rehearsal that failed the test would refuse what the runtime allows. It would be decided by:
  - whether the maintainer wants a rehearsal to be stricter than the runtime on what it can see;
  - whether a program has a use for a message rebuilt otherwise after a crash, as one built from the clock.
- **A chain of keys that loops in a rehearsal.** A timer under a key with a parameter that arms the next parameter at
  the time reached never fires one key twice, so the loop of `advance` in `src/rehearse.ts` never ends. A rule on the
  key's name alone would refuse three reminders of three parameters due at one time, and a catch-up that moves to the
  next parameter. It would be decided by:
  - a rule that fails a key's name only when a firing at the time reached armed it, which needs the rehearsal to keep
    what each firing armed;
  - whether a program needs a chain of parameters at one time at all.
- **A source that gives each item once.** A boundary acknowledges an item once its answer is stored, and the source
  gives the item again until then. A source that keeps nothing, as a socket, gives no item again, so an item in flight
  at a crash of the boundary is lost whatever the boundary does. It would be decided by:
  - a program fed by such a source, and what its domain loses with an item;
  - whether the boundary writes each item to a table of its own before it sends it, and reads that table as the
    source, at the cost of a write for each item.

## The surface

- **The checks of the guide's code and of the quick start read only the blocks fenced `ts`.** The tests of
  `src/form.test.ts` take the blocks fenced exactly `ts`, by the patterns at lines 432 and 451. A block fenced
  `typescript` or `tsx`, or `ts` with an info string, is compared with no example and passes. No page holds such a
  block today.
  - A test that makes the check a function of the text it reads, and gives it a block fenced `typescript` that no
    example holds, would decide it.
- **A reason an operator gives to a discard.** A discard of a message an operation sent stores a rejection with a
  reason of `null`, by `discard` of `src/machine.ts`. The sender cannot tell it from a bare `reject` of the receiver,
  though a discard says the receiver had a bug and an operator dropped the message. An operator could give the reason,
  as `discard(id, { reason })`, typed by the receiver's schema of rejections, with `null` when none is given. A program
  whose schema of rejections is `Never` could take no reason. It would be decided by:
  - a program that acts otherwise on a discard than on a rejection, as one that alerts or sends again later;
  - whether a reason the receiver's schema declares for a discard reads as the receiver's own rule.
- **A handle divided by who uses it.** A `Handle` of `src/runtime.ts` gives ten calls in one interface: a caller's
  `create`, `send` and `read`, `query`, and an operator's `reindex`, `expire`, `suspended`, `inspect`, `resume` and
  `discard`. A boundary that serves callers holds the operator's calls too. Whether a handle is divided into views is
  not decided. It waits for the release, since the surface changes. It would be decided by:
  - the boundaries of the examples, and which calls each uses;
  - whether a view is a type over one handle, or a value a deployment gives, so that a boundary cannot reach what it
    was not given.

## The project's tooling and process

A reading of effect-tea (`github.com/fgaudo/effect-tea`) on 2026-11-17 compared its tooling and its process with this
repository's. The site, the skill `guide-reader` and the names of the files of the tests came from effect-tea already.
The rest is not decided, and is listed here.

- **A lint of the deprecated APIs.** effect-tea fails `bun run lint` on any API marked `@deprecated`, by Oxlint's
  type-aware rule `typescript/no-deprecated`. This repository runs `tsc` alone, so a deprecation that a new release of
  Effect adds shows only when someone reads it. The lint would cost two dependencies of development and a step of
  `ci.yml`. It would be decided by:
  - a run of Oxlint with that rule on `src/`, `examples/` and `scripts/`, which says what it finds today;
  - whether `AGENTS.md` then forbids a deprecated API, as effect-tea's does.
- **A job that runs the tests at the newest Effect.** effect-tea runs, every night, the typecheck and the tests at the
  newest Effect its range accepts, so that a premise a new release breaks is known the day after it is published. This
  repository pins `effect` and every `@effect/` package at one version, 4.1.3, and its workflows run on a push alone.
  The job would update them together, as a move of Effect's version does, and a failure would be a lead for a move,
  not a red commit. It would be decided by:
  - whether `bun update` can move `effect` and the `@effect/` packages together to their newest release within the
    major;
  - whether the job runs the spikes too, since a spike checks a premise about Effect.
- **The procedures of `AGENTS.md` as skills.** effect-tea keeps in `AGENTS.md` the rules that every change keeps, and
  each procedure in a skill read before its task: a change of the API, of an example, a move of Effect, a release.
  This `AGENTS.md` holds the move of Effect's version and the procedure of a reader's check beside the rules of every
  change, and every session loads it whole. It would be decided by:
  - which paragraphs of `AGENTS.md` only one kind of task reads;
  - whether a check of `src/form.test.ts` reads a paragraph that would move.
- **Effect's language service in the typecheck.** effect-tea typechecks with `@effect/tsgo`, which reports an effect
  left unused, a `yield*` missing, and an import that is not a namespace. Its rule `unstableApiUsage` fails on a module
  marked `@stability unstable`. The library imports `effect/sql` and `effect/encoding`, both unstable, and the
  examples import `effect/http` and `effect/http-api`, so that rule cannot be an error here. It could check instead
  that each unstable module `src/` imports has a spike of what the code rests on, which `AGENTS.md` asks and no
  check holds. effect-tea's `prepare` runs `effect-tsgo patch --typescript`, which changes TypeScript in `node_modules`,
  while `AGENTS.md` says that a dependency is never changed there. It would be decided by:
  - whether a patch of the compiler that only the typecheck runs counts as a change of a dependency;
  - whether the language service runs without the patch, and which of its rules this repository would keep.
- **The mutations kept in the repository.** effect-tea keeps one mutation for each check an invariant rests on, in
  `tools/mutations/mutations.ts`, with the tests that must fail under it. Its runner refuses a mutation whose text it
  does not find exactly once, so a refactor shows which mutations to write again. This repository keeps no mutation
  and no runner of them. So a test that stops holding its rule fails nothing, though `AGENTS.md` asks that a rule the
  code keeps have a test that fails without it. It would be decided by:
  - whether the rules of `src/machine.ts` each keep a mutation, beside the test that fails under it;
  - what a run of the whole list costs.
- **The principles of an API.** effect-tea's `AGENTS.md` says that a function earns its place by doing what Effect
  alone cannot, that a type is Effect's or the library's and never half of each, and how a key of the library is
  named. This repository has no such rules for its three entries. It waits for the release, since the surface changes
  then. It would be decided by:
  - a reading of the three entries against those rules, before the surface is published.
- **The tests on Node.** effect-tea runs its tests on Node too, through a shim of `bun:test`, since browsers run V8.
  This repository tests on Bun alone. `./testing` imports `@effect/sql-sqlite-node`, an optional peer dependency, and
  step 11 of the [roadmap](roadmap.md) runs a rehearsal on Node in a project outside Bun. It would be decided by:
  - whether a deployment runs the runtime on Node, or a browser loads more than a program's module;
  - whether the run of step 11 is a job of the CI, or the tests of `src/` run on Node too.
- **Three slow tests of timers.** On the maintainer's Windows machine, `fires a timer whose time passes while the
  waker reads what is due` of `src/runtime.test.ts`, `changes nothing a test reads of the entities` of
  `src/rehearse.test.ts`, and `a subscription is charged at its creation, and again when its stored renewal comes
  due` of `examples/subscription/runtime.test.ts` each take 5 to 10 seconds, past the default timeout of 5 seconds.
  Since `054faac` each test has a timeout of 60 seconds of its own, as the tests of histories have, so all three
  pass. The timeouts hide the time rather than explain it. It would be decided by:
  - whether the library is tested on Windows at all, or the CI's Linux is the only platform the tests promise;
  - a measure of where the time goes, the clock of the test or the database, which could take the three timeouts
    out.
- **A spike whose comment names an option that is gone.** The header comment of
  `spikes/pglite-role-without-ddl.test.ts` says a runtime is launched with `tables: 'existing'`, and `launch` takes no
  such option since the restart. It would be decided by:
  - a reading of the spike against `launch`, which either rewrites the comment or finds the spike checks nothing now.
