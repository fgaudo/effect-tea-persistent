# What the code rests on

A rule of the design holds only while what it rests on holds. Most of it is what Effect, its drivers and the databases
do when they run, which no stable API of the pinned version documents. Each premise the code rests on today is a
bullet here, once, under the area of the code it is about. The rules themselves are in [`design.md`](design.md), and
why each was taken is in the records of [`decisions/`](decisions).

The list is written area by area, by the step The rules move from the notes into documents kept true, of the
[roadmap](roadmap.md). Until that step is done, the premises of the areas not moved yet are in their notes.

## How a premise is written

- A premise says what must hold, then its state, in bold, as one word of a closed set: `tested`, `documented`,
  `seen`, `read`, `read in the source`, `chosen`, `failed` or `open`. A premise may hold two states, as
  `documented` and `seen`.
- A premise said `tested` names its test in backticks: the name of the test or of its group, a script run as
  `bun run <script>`, or the file of the tests. A rename of a test fixes its name here.
- A premise said `documented` names the documentation and the version it was read at. A premise said
  `read in the source` names the module and the version too, since a release may change what the source does.
- A premise says which rule rests on it, by the section of `design.md` that says the rule.
- A premise that fails is a bug of [`bugs.md`](bugs.md), and a premise no test reaches yet is `open`, and is a
  question of [`open-questions.md`](open-questions.md) too.
- A premise that no longer holds, since the code no longer rests on it, leaves the list.
- `src/form.test.ts` checks the states and the names of the tests.

## The tables of versions

The tables `effecttea_versions` and `effecttea_runner_versions` hold, on Cluster, the newest version of each program
and the versions each runner runs, and mark a name a launch renamed. `recordVersions`, `standingOf` and `outranked` of
[`src/storage/cluster.ts`](../src/storage/cluster.ts) read and write them, with `renamed` of
[`src/storage/tables.ts`](../src/storage/tables.ts). `byVersion` and `atNewest` of [`src/cluster.ts`](../src/cluster.ts)
read them. The rules are under A runner and its versions, and under Renaming a program, of `design.md`.

- That a runner not alive gives up its shards, and that the ring holds only the runners marked healthy:
  **documented** by the JSDoc of `RunnerHealth` at Effect 4.1.3, which says that the shards of a runner that is not
  responsive "can and will be re-assigned", and **seen** by
  [`spikes/cluster-unhealthy-runner-gives-up-its-shards.test.ts`](../spikes/cluster-unhealthy-runner-gives-up-its-shards.test.ts).
  A rolling deploy moves every shard to the newer runners by it.
- That a runner registers itself as healthy when it starts, and again whenever it misses itself among the runners
  that `getRunners` returns: **read in the source** of `Sharding.ts` at Effect 4.1.3, in the loop that registers
  `selfRunner`, and **seen** by the second test of the same spike. So the health check alone leaves an older runner
  a shard until the next check, and every step checks the newest version in its own transaction.
- That a defect of a door's handler restarts its entity without end, and saves no reply, unless the door is
  registered with `disableFatalDefects`: **documented** by the JSDoc of `defectRetryPolicy` and of
  `disableFatalDefects` of `Entity.toLayer` at Effect 4.1.3, and **tested** by `a step of an older version dies and
  saves no reply, and a runner of the newest version steps its requests`, in `src/cluster.test.ts`. A step that the
  check of the version refuses rests on it, since it dies and its request is delivered again.
- That Cluster never marks its last healthy runner unhealthy: **read in the source** of `Sharding.ts` at Effect
  4.1.3, in `checkRunner` of the singleton of `RunnerHealth`. Only what a deploy costs rests on it: where every runner
  of the newest version stops, an older runner takes the shards again, and its steps die.
- That a transaction of SQLite on a writable connection takes the file's write lock as it begins, so that a launch's
  record of the versions, a rename's mark and a step come one after the other: **documented** by the JSDoc of the
  module `SqliteClient` of `@effect/sql-sqlite-bun` at 4.1.3, which begins such a transaction with `BEGIN IMMEDIATE`.
  `recordVersions` asks for `BEGIN IMMEDIATE` itself, so that the rule holds if the driver's default changes.
- That on PostgreSQL a launch's `LOCK TABLE effecttea_versions IN SHARE ROW EXCLUSIVE MODE` waits for each step that
  read its program's row `FOR SHARE`: **documented** by the table of conflicting lock modes of PostgreSQL. No test
  runs it, since the runtime runs on Cluster on SQLite alone, until the step The runtime on Cluster across machines,
  on PostgreSQL, of the roadmap.
- That two runners on one file of SQLite, in one process, see each other's commits as two processes would, once each
  opens a connection of its own: **seen** as decision 0163 was taken, where one layer of the client built once gave
  both runners one connection, and the `data_version` of one did not move at the other's commits. So each runner of a test opens a connection of its own,
  and the spike and the tests of a rolling deploy show what two processes would.
- That Cluster draws an entity's shard from its id and the door's shard group alone: **read in the source** of
  `getShardId` of `Sharding.ts` at Effect 4.1.3, which hashes the entity id within the group, while every door of the
  runtime takes the group `default`. **Tested** by `a rename stops the runners of the old name, and its door delivers
  what Cluster saved under it`, in `src/cluster.test.ts`. The door of an old name rests on it, since it routes an id
  to the shard the new name's door holds.
- That a door registered after Cluster read a shard's messages still gets them: **read in the source** of
  `Sharding.ts` at Effect 4.1.3, which resets a message of a type not registered yet until
  `entityRegistrationTimeout`, and then saves a defect as its reply. A door of an old name, registered by a deploy
  after `Sharding` is built, rests on it.
- That `registerEntity` registers a type once on a runner: **read in the source** of `Sharding.ts` at Effect 4.1.3,
  where a type already registered returns at once. The doors a deploy registers, under the program's name and under
  each old name, rest on it, since a second registration of a type changes nothing on the runner.

## The tables of Cluster's requests

The tables `effecttea_sent_requests` and `effecttea_given_requests` hold the Cluster ids of the requests whose rows of
Cluster's the runtime deletes: an operation's under its work, and a caller's or an operator's with the time its rows
are kept until. `cluster_messages` and `cluster_replies` are Cluster's own. `forgetUnder`, `forgetGiven` and
`onClusterOf` of [`src/storage/cluster.ts`](../src/storage/cluster.ts) write them, with the step and `expire` of
[`src/storage/entities.ts`](../src/storage/entities.ts). `reset`, `keptGiven` and `operate` of
[`src/cluster.ts`](../src/cluster.ts) keep and drop a caller's and an operator's ids. The rules are under Cluster's
rows, and under A door and its step, of `design.md`.

- That a client on a runner that does not hold the entity's shard reads its reply from `cluster_replies` at each of
  Cluster's polls of replies, every `entityReplyPollInterval`, and at once when it joins a request already saved:
  **documented** by the JSDoc of `Runners.make` and of `entityReplyPollInterval` at Effect 4.1.3, and
  **read in the source** of `replyFromStorage` of `Runners.ts` at 4.1.3, which reads at once for a waiter that
  joins. **Tested** by `a second client of a caller's request on another runner is answered after a later step`, in
  `src/cluster.test.ts`. The least time rests on it.
- That a reply deleted from `cluster_replies` before that read is never given, so that the client waits for ever:
  **read in the source** of `repliesFor` of `SqlMessageStorage.ts` at Effect 4.1.3, which reads by `request_id`
  alone. A client keeps its id only once it has the answer, and the rows wait for the least time, by it.
- That a client given a `WithExit` reply leaves nothing Cluster still reads under the id, and that a retry within a
  version is answered from the reply saved: **read in the source** of `Runners.ts` at Effect 4.1.3, whose pump drops
  its entry at a `WithExit`, and whose `Duplicate` with a `WithExit` reply is answered at once. A change of it loses
  no data, since a client that finds no rows sends a new request, which the machine answers from the entity's row.
- That the least time outlasts another client's next read of the reply: **tested** where every runner polls at the
  default interval, by `a second client of a caller's request on another runner is answered after a later step`, in
  `src/cluster.test.ts`. It **failed** where another runner polls more slowly than the runner that keeps the id, which
  is bug 89 of [`bugs.md`](bugs.md). The second added covers the read and the clocks of the runners, which share one
  clock while the runtime runs on Cluster on one machine. Whether it holds across machines, and for a client that
  misses two polls, is **open**, and is the [open question](open-questions.md#running) The margin of a caller's rows
  on Cluster, once runners have clocks of their own.
- That a second client of a request on the runner that holds the shard joins the first request, under a `keep` of
  0, so that the message is applied once: **open**. It is the [open question](open-questions.md#running) On Cluster,
  a duplicate of a request on the runner that holds its shard, under a `keep` of 0.
- That a deletion of a processed request's rows by `request_id`, from `cluster_messages` and `cluster_replies`, in
  the transaction of a step that handles another request, leaves no row, and has the runner deliver nothing again:
  **seen** by [`spikes/cluster-forgets-a-request-deleted-by-its-id.test.ts`](../spikes/cluster-forgets-a-request-deleted-by-its-id.test.ts).
  Every deletion of Cluster's rows rests on it.
- That Cluster does not deliver again a request it marked processed, whether its replies are there or not:
  **read in the source** of `getUnprocessedMessages` of `SqlMessageStorage.ts` at Effect 4.1.3, which reads only
  rows whose `processed` is false. A batch of `expire` deletes an id and Cluster's rows under it in one transaction,
  and rests on it where a crash ends the batch.
- That Cluster's tables are `cluster_messages` and `cluster_replies`, each with a column `request_id`:
  **documented** for the prefix `cluster` by the JSDoc of `SqlMessageStorage.makeEncoded` at Effect 4.1.3, and
  **read in the source** of the same module for the names that follow the prefix and for the column. The statements
  of `forgetUnder` name them.
- That `MessageStorage.requestIdForPrimaryKey` gives the Cluster id of a request saved under a primary key:
  **documented** by its JSDoc at Effect 4.1.3. A caller's client finds the id it keeps by it, and `reset` finds the
  request it resets.
- That the id a door's handler is given with the request is the id of Cluster's rows of the request: **tested** by
  `an operator’s resume and discard leave no Cluster rows past the least time`, in `src/cluster.test.ts`. An
  operator's id, and an operation's id kept under its work, rest on it.
- That a persisted request with no primary key is saved with none, and is deduplicated with no other:
  **read in the source** of `saveEnvelope` of `SqlMessageStorage.ts` at Effect 4.1.3, and **tested** by
  `an operator’s resume and discard go through the door, each a request of its own`, in `src/cluster.test.ts`. So an
  operator's event has one client, which finds the event's id in the door's answer.
- That an id kept twice keeps its first row, that the id of a request answered after its asker's work ended is
  pending, and that an id past 2^53 is deleted to its last digit: **tested** by `on Cluster, an id kept under work goes
  with it, and a pending one with the next step, to its last digit`, in `src/storage.test.ts`.
- That a door's step reads the asker's work either after the step that ended the work committed or before that step
  began, so that the id of a request answered as the work ends is either kept and deleted or pending: **documented**
  by the JSDoc of the module `SqliteClient` of `@effect/sql-sqlite-bun` at 4.1.3, which begins a transaction on a
  writable connection with `BEGIN IMMEDIATE`, so that the transactions of one file come one after the other.
- That an operation's work takes Cluster's rows of its creation and its message as it ends, and the next step those of
  `Resumed`: **tested** by `src/cluster.test.ts`, in the test whose name begins `an operation's work takes Cluster's
  rows of its requests as it ends`.
- That a caller's rows go once its client has the answer and its time is past, by a step and by `expire`: **tested** by
  `a caller’s Cluster rows go once its client has the answer and its time is past, by a step or by expire`, in
  `src/cluster.test.ts`.
- That a retry of a creation whose Cluster rows are gone is answered `Created`: **tested** by `a caller’s creation
  leaves its Cluster rows to expire, and a retry after is answered Created`, in `src/cluster.test.ts`.
- That the deletion of a kept id commits before `Sharding.reset` runs, so that no step reads the id after the reset:
  **tested** by `a retry of a rejected creation is answered though an expire runs before Cluster delivers it again`,
  by `a retry of a message answered Suspended is answered though an expire runs before Cluster delivers it again`, and
  by `the step that answers a retry of a message answered Suspended leaves no reply without its request`, in
  `src/cluster.test.ts`. Each failed before decision 0249 once its wait was past the least time.
- That a step which deletes a request's rows between the reset's read of the latest answer and the deletion of the
  kept id loses nothing: **read in the source** of `Runners.ts` and of `saveEnvelope` of `SqlMessageStorage.ts` at
  Effect 4.1.3. The send that follows finds no rows and is a new request, which the machine answers from the
  entity's row.
- That `Sharding.reset` with the latest reply expected deletes the reply and marks the request unprocessed only while
  that reply is still the latest: **read in the source** of `clearReplies` of `SqlMessageStorage.ts` at Effect 4.1.3,
  whose statements check `last_reply_id`, and **tested** by `a message answered NotFound is handled when it is sent
  again, once its entity is created`, in `src/cluster.test.ts`. So a reset that finds a newer reply, of a concurrent
  retry, leaves it.
- That a second client's reset may drop the kept id of an answer that is a reply, which the first client's retry
  kept: **open**, as a reading of `reset` that no test runs yet. It is bug 91 of [`bugs.md`](bugs.md), and the
  [open question](open-questions.md#running) The rows of operators' events on Cluster. Only a second client
  interrupted then leaves the rows for ever.
- That Cluster saves a failure of its own for a request whose entity type no runner registered in time:
  **documented** by the JSDoc of `entityRegistrationTimeout` at Effect 4.1.3, and **tested** by `a request Cluster
  failed, its type registered by no runner in time, is reset, and handled once it is`, in `src/cluster.test.ts`. A
  client resets such a failure before it gives it, and deletes the id it kept first.
- That Cluster saves a defect of its own only for a delivery that dies before it reaches the door, and nothing for an
  interruption: **read in the source** of the storage loop of `Sharding.ts` at Effect 4.1.3.
- That a reply saved for a request whose rows are gone is inserted all the same, and is never given: **seen** by
  [`spikes/cluster-forgets-a-request-deleted-by-its-id.test.ts`](../spikes/cluster-forgets-a-request-deleted-by-its-id.test.ts),
  and **read in the source** of `saveReply` and `repliesFor` of `SqlMessageStorage.ts` at Effect 4.1.3. That the few
  rows it leaves are not worth a sweep is **chosen** by
  [decision 0173](decisions/archive/0173-on-cluster-a-reply-cluster-saves-after-its-request-is-gone-is-left.md).
- That the step that ends an operation's work deletes the rows of a request Cluster failed and reset, before a runner
  that registers the type delivers it: **tested** by `an operation's request Cluster failed is kept under its work,
  and goes with it before it is delivered`, in `src/cluster.test.ts`.
- That a client finds the asker's work ended only on a runner that no longer holds the asker's shard, so that its
  wait until interruption guards a runner whose finalizer never ran: **open**. No test reaches the wait, and the case is
  the [open question](open-questions.md#running) A send after the work it belongs to ended.
- That a handler of `Effect.catchCause` can be interrupted, so that the wait of such a client ends with its fiber:
  **read in the source** of `internal/effect.ts` at Effect 4.1.3, where `catchCause` is the primitive `OnFailure`,
  whose handler runs as a continuation of the fiber.
- That a client decodes the answer of a door of an older release, and a client of an older release decodes a newer
  door's answer to an operator: **documented** by the JSDoc of `Schema.optionalKey`, and by that of the default
  `onExcessProperty` of `ParseOptions` in `SchemaAST.ts` at Effect 4.1.3, which strips a key the schema does not name.
- That a saved answer ends Cluster's restarts of the door, so that a creation the program dies on is not delivered
  again once answered `Died`: **documented** by the JSDoc of `defectRetryPolicy` of `Entity.toLayer` at Effect 4.1.3,
  whose backoff resets once a request completes, and **tested** by `a creation the program dies on stores nothing, is
  answered Died, and is not delivered again`, in `src/cluster.test.ts`.
- That a `Died` saved and never reset, as by a process that died before its client's next call, is reset before the
  next send: **tested** by `a creation init died on, whose saved answer was never reset, runs init again at the
  retry`, in `src/cluster.test.ts`.
- That two clients of one creation `init` died on, on two runners, both reset the saved `Died`, are both answered
  `Created`, and create the entity once: **tested** by `two callers of one creation init died on, on two runners, are
  both answered Created once it is fixed`, in `src/cluster.test.ts`.
- That Cluster writes its reply as JSON, which escapes a U+0000 of a `Died`'s cause: **tested** by `the cause of a
  creation the program dies on reaches Cluster with its U+0000 escaped`, in `src/cluster.test.ts`.
- That `Effect.uninterruptibleMask` keeps the read of an answer's id and its keep whole while the wait for the answer
  can be interrupted: **documented** by its JSDoc at Effect 4.1.3, `@stability stable`.

## The tables of replies

The table `effecttea_replies` holds the replies of a step: a caller's, kept for its `keep`, and another entity's
operation's, kept while the work that asked holds. `effecttea_answers` holds the answers no entity stores, a
creation `init` rejected and a message's `NotFound`, kept for an operation's work. `effecttea_waiting` holds the
operations that wait for a suspended entity's resumption. `write`, `reply`, `answer`, `keepAnswer`, `expire`, `ended`
and `waitingOf` of [`src/storage/entities.ts`](../src/storage/entities.ts) write and read them, with `waiters` of
`onClusterOf` in [`src/storage/cluster.ts`](../src/storage/cluster.ts). The rules are under Messages, Entities that
talk, Defects, The sweep, What the storage writes and Fibers and locks, of `design.md`.

- That only the boundary knows how long its callers retry for, so that `keep` is required and has no default:
  **chosen** by [decision 0125](decisions/archive/0125-a-callers-reply-is-kept-as-long-as-its-boundary-says.md), and
  again by [decision 0245](decisions/archive/0245-a-reply-is-kept-as-long-as-send-says-and-the-runtime-sweeps.md). A boundary
  that gives a `keep` shorter than its callers' retries has a message applied twice.
- That the runtime's clock and the boundary's agree well enough for a `keep` counted on the runtime's clock: **open**.
  A skew between the two shortens or lengthens the window by that skew. It is the
  [open question](open-questions.md#running) A boundary's clock against the runtime's, for a reply's `keep`.
- That the machine counts a caller's time from the step that answers, and gives another entity's reply none:
  **tested** by `how long a reply is kept (decision 0125)`, in `src/machine.test.ts`.
- That a reply is read before its time only, and that a step and `expire` delete what is past it, of the entity and of
  the program alone: **tested** by `how long a caller’s reply is kept (decision 0125)`, in `src/storage.test.ts`.
- That a retry within `keep` is answered from storage, one after it is applied again, and a `keep` that is no count is
  the caller's defect: **tested** by `a retry within the keep its boundary gives is answered from storage, and one
  after it is applied again` and by `a keep that is neither a whole number of millis nor forever is the caller’s
  defect, and reaches no entity`, in `src/runtime.test.ts`.
- That a sweep frees what the steps leave and changes no answer: **tested** by `expire deletes past a batch, counts
  every row, and on Cluster takes the ids of every batch`, in `src/storage.test.ts`, by `the sweep expires and prunes
  at its interval, and one that fails is warned of and leaves the next`, in `src/runtime.test.ts`, and on Cluster by
  `on Cluster the sweep runs as a singleton, and takes the replies and Cluster rows past their time`, in
  `src/cluster.test.ts`.
- That a sweep in batches needs no more room on a full volume than one statement: **seen** by
  [`spikes/full-volume.test.ts`](../spikes/full-volume.test.ts), on the CI's volume of 32 MB, where the batches of a
  prune took about 824 KB of a freed megabyte and one prune 892 KB. So the batches serve the writer's time and not the
  room, and an operator frees room first on a disk that is really full.
- That a singleton of Cluster has one active owner, the runner that holds its shard: **documented** by the JSDoc of
  the module `cluster/Singleton.ts` at Effect 4.1.3, `@stability unstable`. The sweep on Cluster rests on it for its
  cost alone, since two runners that sweep at once delete the same rows past their time.
- That PostgreSQL skips a row another transaction locks under `SKIP LOCKED`, rather than waiting for it, and reads the
  `WHERE` of a `SELECT … FOR UPDATE` again on a row committed after the statement's snapshot: **documented** by the
  locking clause of `SELECT` of PostgreSQL 17, the version of the CI's server. A batch of `expire` rests on both.
- That a batch of `expire` beside a step that answers a retry again, on a pool, keeps the reply the step wrote with its
  new time: **tested** by the examples of bug 13 in `two calls held at a statement on a pool answer as one order of
  them`, in `src/contract.test.ts`, in the job `postgres` of the CI.
- That the clause of the lock changes nothing on SQLite and on PGlite, and that the sweep ends: **tested** by `expire
  deletes past a batch, counts every row, and on Cluster takes the ids of every batch`, in `src/storage.test.ts`.
- That a sweep skips a reply a step holds rather than waiting for the step: **chosen** by
  [decision 0285](decisions/archive/0285-a-batch-of-expire-skips-the-replies-a-step-holds.md). A reply skipped is deleted by a
  later sweep, or by the step itself.
- That a batch which waits for no reply's row closes no deadlock with a step that deletes its entity's replies:
  **tested** by the case `bug49` of `two calls held at a statement on a pool answer as one order of them`, in
  `src/contract.test.ts`, in the job `postgres` of the CI, which deadlocked against a batch that waits. It is bug 49
  of [`bugs.md`](bugs.md).
- That a statement of PostgreSQL at `READ COMMITTED` reads a snapshot taken as it starts: **documented** by the
  section Transaction Isolation of PostgreSQL 17. The second statement of a batch of `ended` rests on it, to read the
  sender's key as committed once the rows are locked.
- That two steps at once on a pool, the receiver's that stores a reply or an answer and the asker's that ends the work,
  leave the row, and that a sweep beside them waits for neither and deletes it after: **tested** by the four tests of
  `a reply to work that ends while its receiver stores it`, in `src/postgres.test.ts`, in the job `postgres` of the CI.
- That `expire` deletes what a work that ended was given, past a batch, and keeps what a work that holds was given:
  **tested** by `expire deletes the replies and the answers kept for work that has ended, and keeps those of work that
  holds`, in `src/storage.test.ts`, on SQLite and PGlite.
- That an incarnation is never drawn again for one key of one entity: **tested** by `a key that leaves loses its row,
  and comes back in an incarnation no run of it had`, in `src/machine.test.ts`. The deletion of what a work that ended
  was given rests on it, since the key it finds absent stays absent.
- That an entity's row, which holds the count of its incarnations, is never deleted: **tested** by `no statement of
  src deletes the row of an entity`, in `src/form.test.ts`.
- That an asker's key is committed before its request reaches the receiver: **tested** by `an operation’s request
  reaches its receiver only once the step that started the operation is committed`, in
  `src/runtime/callers.test.ts`. Where it fell, a receiver's step and the sweep would delete a reply the work still
  waits for.
- That a row left until the next sweep costs no wrong answer, since no reader looks for a reply or an answer of work
  that has ended: **chosen** by the maintainer, in
  [decision 0289](decisions/archive/0289-expire-deletes-what-work-that-ended-was-given.md).
- That one process gives a run after a crash the kept rejection and the kept `NotFound`, and that the work's end
  deletes the answer: **tested** by `an at-least-once operation run again after a crash acts once, though init
  rejected its creation` and by `an at-least-once operation run again after a crash acts once, though its message
  found no entity`, in `src/runtime.test.ts`.
- That a door's step answers a delivery again with the kept answer, after another creator made the entity: **tested**
  by `an operation’s request a door answered Rejected or NotFound is answered so again, though its entity exists`, in
  `src/runtime/doors.test.ts`, with a Cluster the test plays.
- That Cluster's client delivers an operation's request to the door again after a crash, so that the door's step reads
  the kept answer: **open**. No test runs a crash between two runs of an operation on Cluster. It is the
  [open question](open-questions.md#running) An operation's kept answer on Cluster across a crash, and under two runs
  at once.
- That only the operation's own runs read or write its answers, one run after the other, so that a kept answer is read
  outside the receiver's lock: **open**, in the same open question. Decision 0274 keeps two runs of one incarnation
  apart on one runner and across an orderly move of a shard, and a runner that lost its lease is left.
- That a rehearsal gives a run after a crash the same kept answers: **tested** by `answers a run after a crash as the
  first, where init rejected its creation or its message found no entity`, in `src/rehearse.test.ts`.
- That an operation's request is one text whatever the version of either program, so that its kept answer is found
  across a deploy: **tested** by `an operation's request is one text whatever the receiver's schema of its sender`, in
  `src/machine.test.ts`.
- That a message or flags of one value encode to one text, whatever order its fields were given in, and that a retry
  decoded from the same request encodes to the same text: **tested** by the tests of `what a request carries encodes
  to one text (decision 0269)`, in `src/machine.test.ts`, which also see that an equal set built in another order is
  another text.
- That Cluster answers a request under a primary key it saved from the saved reply, and saves no envelope of it for the
  door, whatever message the request carries: **tested** by `another message under a caller's request id reaches the
  door, which answers it Reused`, in `src/cluster.test.ts`. A caller's primary key holds the message's text by it.
- That a second client's reset of a `Reused` may drop the keep of the answer another client's send kept: **open**. It
  is the [open question](open-questions.md#running) A `Reused` reset by two clients on Cluster, and a case of bug 91
  of [`bugs.md`](bugs.md).
- That a run of an operation after a crash which sends another message under the same name is given the first
  message's reply, and the receiver holds the first message alone: **tested** by the tests of `a run after a crash that
  sends another message under an operation's request`, in `src/machine.test.ts`, by `an at-least-once operation run
  again after a crash that sends another message under a name is given the first reply`, in `src/runtime.test.ts`,
  and by `answers a run after a crash that builds another message or other flags with the first one's reply`, in
  `src/rehearse.test.ts`.
- That two callers under one request id with two messages at once are given their own answers: **tested** by `two
  callers under one request id with two messages at once are answered Accepted and Reused`, in `src/runtime.test.ts`.
- That a retry after a deploy is compared with what the caller's request carried, read through the migrations:
  **tested** by `a retry after a deploy is compared with what the caller's request carried, read through the
  migrations`, in `src/runtime.test.ts`, on each storage.
- That a request after a reply's `keep` is a new request, whatever it carries: **tested** by `another message under a
  caller's request id after the reply's keep is a new request, and is applied`, in `src/runtime.test.ts`.
- That a boundary which decodes the same request off the wire under the new version gets the message the migration
  writes: **chosen** by [decision 0269](decisions/archive/0269-a-callers-request-is-its-sender-its-id-and-what-it-carries.md).
  The library cannot check a boundary.
- That the room a reply's row takes for its message is worth the check of what a request carries: **chosen** by the
  maintainer, on 2026-11-11. A caller's row is kept for its `keep` alone, so the room is bounded by what callers send
  within their keeps.
- That two callers of one request at once under a `keep` of 0 have the message applied once, and that a skipped
  `Receive` gives its permit back and is counted as done: **tested** by `two callers of one request at once under a
  keep of 0 have its message applied once`, in `src/runtime.test.ts`.
- That a retry sent after its first caller gave up, with the first `Receive` queued behind another message, is
  answered and applied once: **tested** by `a retry after a caller gave up behind another message is answered by the
  first offer, and applied once`, in `src/runtime.test.ts`.
- That a retry offered before the answer is not stepped: **tested** by `a message that waits behind another is given
  its time as its step begins, and a retry before the answer is answered by it`, in `src/runtime.test.ts`.
- That every reply to a caller's request on one process goes through a step's `Replied`: **tested** for the reply of a
  step by `two callers of one request at once under a keep of 0 have its message applied once`, in
  `src/runtime.test.ts`. A reply given by an operator's resume to a retry in flight is **open**, the
  [open question](open-questions.md#running) A retry in flight when an operator resumes the entity.
- That a retry sent after the answer, within its `keep` but stepped past it, is given the reply: **open**. It is the
  [open question](open-questions.md#running) A retry that waits in the runtime past its reply's `keep`.
- That a step answering an operation `Suspended` writes its wait, that a caller's request writes none, that an
  operation queued when the entity suspends writes one, and that the resumption says the waits go: **tested** by the
  tests of `the operations a suspended entity answers`, in `src/machine.test.ts`. The wait is written by the step that
  answers, in the step's one transaction, so no resumption commits between the answer and the wait.
- That the storage lists the waits whose run holds, stores a wait answered twice once, leaves out a run restarted or
  ended, and deletes every wait when the suspension ends: **tested** by `a suspended entity lists the stored waits
  whose run holds, and its resumption deletes them`, in `src/storage.test.ts`, on SQLite and on PGlite.
- That the operation of a suspended sender is listed after a restart: **tested** by `after a restart, a suspended
  entity lists the operation of a suspended sender that waits for it`, in `src/runtime.test.ts`.
- That an operator on any runner of Cluster sees the operation of another runner that waits: **tested** by `an
  operator on any runner sees the operation of another runner that waits for a resumption`, in `src/cluster.test.ts`,
  under `bun run test:slow`.
- That an operator should see who waits whatever process answers, at the cost of a write per wait: **chosen** by the
  maintainer, in
  [decision 0265](decisions/archive/0265-the-operations-that-wait-for-a-resumption-are-stored-by-the-step-that-answers.md).
- That a wait whose operation, run again under the same incarnation, sends to another entity misleads no operator:
  **open**. The wait stays listed under the first receiver until its suspension ends. It is the
  [open question](open-questions.md#running) A wait whose operation, run again, sends elsewhere.

## The tables of an entity

The table `effecttea_entities` holds an entity's row: its state, its creation and flags, the count of its
incarnations and of its steps, its partition, and its suspension with the cause rendered as text.
`effecttea_entity_keys` holds its keys, with each incarnation, work and time due, and `effecttea_mailbox` its queue of
messages in order. `write` of [`src/storage/entities.ts`](../src/storage/entities.ts) writes them, and `entity` reads
them for `load`, `inspect` and `examine`, with `entities`, `suspensions`, `interruptedWithin`, `due` and `stepsOf`.
[`src/check.ts`](../src/check.ts) reads them by `examine` and `entities`. The rules are under Defects, Checking a
program before its deploy and What the storage writes, of `design.md`.

- That `inspect` gives the state, the mailbox, the work and the suspension as stored, and activates nothing: **tested**
  by `an operator inspects an entity: its state, its mailbox, its work and its suspension, as stored`, in
  `src/runtime.test.ts`, on SQLite and PGlite.
- That on SQLite a step can commit between two statements read outside a transaction, and none can within one:
  **documented** by the JSDoc of `makeSqliteAcquirers` in `sql/SqlClient.ts` at Effect 4.1.3, whose borrower holds the
  connection's semaphore until a statement finishes and whose acquirers hold it until the transaction's scope closes,
  and **read in the source** of `SqliteClient.ts` of `@effect/sql-sqlite-bun` at 4.1.3, whose client is built with it.
  **Tested** by `an inspection reads one snapshot, so a step that commits meanwhile is read whole, under prioritized
  schedules`, in `src/runtime.test.ts`. `inspect`, `suspended` and each entity of `check` rest on it.
- That `REPEATABLE READ` gives every statement of a transaction its first snapshot on PostgreSQL: **documented** by the
  section Transaction Isolation of PostgreSQL 17. Whether a reading of one snapshot sees a step whole against a pool of
  PostgreSQL is **open**: no test runs `inspect` beside a step on a server with a pool. It is the
  [open question](open-questions.md#storage-and-reading) A reading of one snapshot beside a step, on a pool of
  PostgreSQL.
- That `inspect` lists the waits that `suspended` lists: **tested** by `a suspended entity lists the stored waits
  whose run holds, and its resumption deletes them`, in `src/storage.test.ts`, which reads both. Both read
  `effecttea_waiting` by `waitingOf`, in the snapshot of the reading.
- That the time of a suspension is kept through a step while the entity stays suspended, and cleared with the
  suspension: **tested** by `a suspended entity is listed with what it died on, its cause and since when, kept while
  it stays suspended`, in `src/storage.test.ts`.
- That PostgreSQL holds U+0000 in no text, so that a cause written as it was fails the suspension's write:
  **tested** by `a defect whose cause holds U+0000 suspends the entity, and lists it`, in `src/runtime.test.ts`, on
  SQLite and on PGlite, which failed before the cause was escaped.
- That every cause a suspension stores passes through `render`: **tested** by `the cause a suspension writes is text a
  database holds, with each character none holds escaped`, in `src/machine.test.ts`, and by `a defect whose cause
  holds U+0000 suspends the entity, and lists it`, in `src/runtime.test.ts`.
- That a regular expression with the flag `u` reads a pair of surrogates as one code point, so that `\p{Cs}` finds a
  lone surrogate alone: **documented** by ECMAScript, and **tested** by `the cause a suspension writes is text a
  database holds, with each character none holds escaped`, in `src/machine.test.ts`, whose cause holds a pair.
- That `check` finds what a deploy does, for an entity not suspended and for a suspended one: **tested** by `finds the
  entities whose activation the new program suspends, as a deploy then suspends them` and by `checks a suspended entity
  as a resume would activate it`, in `src/check.test.ts`, on SQLite and PGlite.
- That a `Load` is told apart from an `Activation` and from what the runtime throws, a version no migration reads
  included: **tested** by `tells a row the migrations do not read from an activation that suspends` and by `dies on
  what the runtime throws: a row that is no JSON, and tables another release made`, in `src/check.test.ts`.
- That `Migrator` records `0001_tables` as the id 1 and the name `tables`: **read in the source** of the loader
  `fromRecord` of `sql/Migrator.ts` at Effect 4.1.3, which parses a migration's key into its id and name, and **tested**
  by `dies on what the runtime throws: a row that is no JSON, and tables another release made`, in
  `src/check.test.ts`, which reads the guard's message. The check of the tables rests on it.
- That a discard of a message an operation sent stores a rejection, only for such a message and only where the entity
  is resumed: **tested** by `a message an operation sent is discarded with a rejection stored, which its next send is
  answered`, by `a discard that leaves the entity suspended keeps the message an operation sent, and stores no reply`
  and by `an inbound message the entity died on is discarded, with no reply stored`, in `src/machine.test.ts`.
- That the operation's `send` is then given the stored rejection and does not send again: **tested** by `a discard
  gets an entity past the message an operation sent, which the operation does not send again`, in
  `src/runtime.test.ts`, and on Cluster by `a discard on another runner of the message an operation sent is answered
  to the operation as a rejection`, in `src/cluster.test.ts`, under `bun run test:slow`.
- That the discard's rejection, stored for work that already ended, is deleted as it is written: **tested** by `a reply
  asked by work that no longer holds goes as it is stored, and one whose work holds is kept`, in `src/storage.test.ts`.
- That a sender handles a rejection with a reason of `null`: **documented** by the type of the reply of `send`, whose
  rejection's reason is `null` for a bare `reject` of every program.
- That a sender need not tell a discard from a bare `reject`: **chosen** by the maintainer, in
  [decision 0260](decisions/archive/0260-a-discard-of-a-message-an-operation-sent-stores-a-rejection.md).

## The tables of projections and of the log

The table `effecttea_projections` is the read model: one row for each entity, its projection and the value of each
index. `effecttea_log` holds the number of partitions of the log, and `effecttea_heads` the head of each partition,
whose `seq` a step draws. `reindex`, `query`, `count`, `sum`, `countBy` and `projected` of
[`src/storage/projections.ts`](../src/storage/projections.ts) write and read the read model, with `write` of
[`src/storage/entities.ts`](../src/storage/entities.ts). `write` moves the head of the step's partition, `published`
and `heads` of [`src/storage/log.ts`](../src/storage/log.ts) read the heads, and `partitioned` of
[`src/storage/tables.ts`](../src/storage/tables.ts) stores the number of partitions. The rules are under Reading,
The order of the log and What the storage writes, of `design.md`.

- That SQLite finds no row under a criterion of `NaN` where PostgreSQL finds rows, and that PostgreSQL fails a
  statement whose parameter of text holds U+0000 where SQLite answers it: **seen**, in the reproduction of the bug and
  in a probe of both dialects, as
  [decision 0207](decisions/archive/0207-a-criterion-is-a-scalar-both-dialects-compare-alike.md) was taken. The refusal of a
  lone surrogate rests on no premise of how it compares.
- That every criterion and cursor of `query`, `count`, `sum` and `countBy` passes through `criteria` or `cursorOf`:
  **tested** by `a criterion or a cursor that is no scalar a query compares is its caller’s defect, on both dialects`,
  in `src/storage.test.ts`.
- That SQLite compares the value of `json_extract` with a parameter in the order its `ORDER BY` sorts them, `NULL`
  first, then numbers, then text, and that `NULL` sorts first ascending and last descending: **documented** by
  SQLite's pages on datatypes and on `SELECT`, and **tested** by `a query pages past the last row it gave, through ties
  and nulls, in either order`, in `src/storage.test.ts`, which also holds that the indexes a row stores are those a
  query compares.
- That `json_extract` gives JSON's `true` as 1, so that a boolean index and a boolean of a cursor compare as 1 or 0:
  **seen**, as [decision 0143](decisions/archive/0143-a-query-pages-after-the-last-row-it-gave.md) was taken, and
  **tested** by `a query pages past the last row it gave, through ties and nulls, in either order`, in
  `src/storage.test.ts`.
- That SQLite searches each statement of a page as a range of the index, and sorts in none of them: **seen** by
  [`spikes/sqlite-page-statements-plan.test.ts`](../spikes/sqlite-page-statements-plan.test.ts), which reads the plan
  of each on the table the storage creates. That such a statement stops after the rows it gives under its limit is
  **documented** by SQLite's page on the query planner, and no spike counts the rows SQLite visits.
- That `-Infinity` is bound as a real, and every value an index stores but `null` is greater: **seen** by the same
  spike, and **documented** by SQLite's page on datatypes.
- That SQLite reads the digits `JSON.stringify` writes of an integer beyond 2^53 as another number, and the exact
  digits of the double as the same number: **seen** by
  [`spikes/sqlite-json-integer-digits.test.ts`](../spikes/sqlite-json-integer-digits.test.ts), and **documented** by
  SQLite's pages on datatypes and on JSON. That `BigInt` gives the exact integer a double holds is **documented** by
  ECMAScript.
- That a page past a cursor of such a value, and a criterion `=` on it, find the row once: **tested** by `a query pages
  past, and finds by its value, a row whose index is an integer beyond 2^53`, in `src/storage.test.ts`, and the write of
  such an index by `reindex writes an index that is an integer beyond 2^53 with its exact digits`, in the same file.
- That one statement reads the rows as one snapshot, so that a step that commits meanwhile is counted wholly or not
  at all by `count`, `sum` and `countBy`: **documented** by SQLite's page on isolation, and by the section Transaction
  Isolation of PostgreSQL 17 for a statement at `READ COMMITTED`.
- That `json_type` gives `true`, `false`, `integer`, `real`, `text` and `null`, and SQL's NULL for a path the row
  lacks, and that `TOTAL` gives `0.0` over no row: **documented** by SQLite's pages on its JSON functions and its
  aggregates, and **tested** by the tests of `a count and a sum over the entities that match (decision 0148)` and of
  `a count per value of an index (decision 0150)`, in `src/storage.test.ts`, at the SQLite 3.53.4 that Bun 1.4.4
  holds.
- That a count, a count per value and a sum compare as a query does: **tested** by `a count, a count per value and a
  sum read the rows a query finds`, in `src/storage.test.ts`.
- That no caller sums an index of strings on purpose, so that a string in a sum is the caller's defect: **chosen** by
  [decision 0148](decisions/archive/0148-a-count-and-a-sum-are-read-in-one-statement.md). A caller that wants the rows
  holding a string counts them with a criterion.
- That `TOTAL` gives a double and adds an integer beyond SQLite's without failing: **documented** by SQLite's page on
  its aggregates, and **tested** by `a count finds the rows a query finds, and a sum adds their numbers and leaves out
  the rest`, in `src/storage.test.ts`. The rule rests on no compensation of `TOTAL`, since the test of the dialects
  allows the difference a plain sum of doubles makes.
- That `SUM` over `NUMERIC` does not fail on a total past the largest double, and that a cast of a number of `jsonb` to
  `NUMERIC` gives the decimal JSON wrote, exactly: **documented** by PostgreSQL's pages on numeric types and on JSON
  types, and **seen** on PGlite 0.5.15. That `Number` reads the text of a decimal as the nearest double is
  **documented** by ECMAScript.
- That both dialects give totals within a few units of the last place of the total of magnitudes: **tested** by
  `every backend answers every call alike`, in `src/contract.test.ts`.
- That both dialects give the same units of 2^980 and the same refusal at the bound of a sum: **tested** by `a sum is
  answered one unit under the bound of its magnitudes, and refused at it`, in `src/storage.test.ts`, on SQLite and
  PGlite, by `a sum whose magnitudes pass the largest double is its caller’s defect`, in the same file, and by `a sum
  whose exact total of magnitudes reads back as the largest double is answered alike on both dialects`, in
  `src/contract.test.ts`. A cast of a number of `jsonb` to `DOUBLE PRECISION` gives the double JavaScript wrote by the
  first test, whose units differ by one where the double does.
- That SQLite's cast of a real to an integer cuts toward zero: **documented** by SQLite's page on `CAST` expressions.
- That a sum of integers under 2^53 is exact in doubles, a multiplication by 2^-980 of a double of at least 1e290 is
  exact, and each addition rounds by at most half an ulp of its result: **documented** by IEEE 754. That no partial
  total of `TOTAL` overflows below the bound, by a margin of `numbers × (2^980 − 2^970)`, rests on them, since SQLite
  does not document the order of its additions, and is **seen** by the cases of the test at the bound.
- That PostgreSQL fails a statement on a product under the least double, so that the statement tests the magnitude
  before it multiplies: **seen** on PGlite, as
  [decision 0277](decisions/archive/0277-a-sum-is-refused-by-a-count-of-its-magnitudes-both-dialects-make-alike.md) was taken,
  and run by the case of `Number.MIN_VALUE` of `a sum is answered one unit under the bound of its magnitudes, and
  refused at it`, in `src/storage.test.ts`.
- That refusing the top `numbers × 2^980` of the range costs a caller nothing that matters: **chosen** by the
  maintainer, in decision 0277.
- That `reindex` beside a message on a pool leaves the projection the message's step wrote, and that PostgreSQL accepts
  `FOR UPDATE` in the `SELECT` of an `INSERT … ON CONFLICT` and reads its `WHERE` again on the row committed: **tested**
  by the examples of bug 25 in `two calls held at a statement on a pool answer as one order of them`, in
  `src/contract.test.ts`, in the job `postgres` of the CI.
- That `reindex` leaves no row a step has moved past, on one process: **tested** by `reindex leaves no row a step has
  moved past, under prioritized schedules`, in `src/runtime.test.ts`, and on a state of the same text at another
  version by `reindex skips an entity that a step wrote since, though its state has the same text at another version`,
  in `src/storage.test.ts`.
- That a step takes its entity's row before it writes its projection, so that `reindex`, which locks in the same
  order, closes no cycle of locks: **open**. The order is the one of the statements of `write`, and no test fails
  where it is reversed. It is the [open question](open-questions.md#storage-and-reading) Orders of the storage no test
  holds.
- That a statement locking the condition, rather than a guard in the outer `WHERE`, `REPEATABLE READ` or an advisory
  lock, is the rule to keep: **chosen** by the maintainer, in
  [decision 0284](decisions/archive/0284-a-statement-reads-its-condition-from-a-row-it-has-locked.md).
- That what the program computes of a row, a migration, the state's schema, `project`, an index and the projection's
  encoding, runs inside the guard that tells its throws from the runtime's: **tested** by `reindex passes over a state a
  migration or the schema dies on, and fails on a text that is no JSON` and by `reindex passes over a state an index
  dies on, names it, and writes the rest`, in `src/storage.test.ts`, and by `reindex leaves the row of an entity whose
  state the new project dies on, names it, and writes the rest`, in `src/runtime.test.ts`. That the projection's
  encoding dying is passed over alike is **open**, in the same open question.
- That a read with a new program whose `project` dies is answered from the row, without a defect: **tested** by `a
  read answers from the row, with a new program whose project dies on the state`, in `src/runtime.test.ts`.
- That every event which changes an entity's state writes its row of the read model in the same transaction, and
  that a caller is answered only once its step has committed, so that a read after the answer finds the row: **open**.
  The test that checked the first after random events and crashes is gone, and the tests that read after a `send`
  pass either way. It is the [open question](open-questions.md#storage-and-reading) Orders of the storage no test
  holds.
- That a row locked by an update stays locked until its transaction ends, so that the steps of a partition commit in
  the order of their `seq`: **documented** by the chapter Explicit Locking of PostgreSQL 17, and **tested** by `two
  writers of one partition commit in the order of their seq, the second waiting for the first`, in
  `src/postgres.test.ts`, in the job `postgres` of the CI. On SQLite every transaction commits one at a time.
- That a step draws its `seq` by an update of its partition's head, in its own transaction, so that a row up to the
  head a reading read committed before the reading: **tested** by `two writers of one partition commit in the order of
  their seq, the second waiting for the first`, in `src/postgres.test.ts`, whose second writer waits for the first's
  head.
- That SQLite runs `INSERT … ON CONFLICT DO UPDATE … RETURNING`, which writes a partition's head at its first step and
  moves it at the next: **documented** by SQLite from 3.35, and **tested** by `the entities of one partition share its
  sequence, in the order their steps committed`, in `src/runtime.test.ts`.
- That a reading of the log gives every row of a partition before one it gives, where steps commit between its
  statements or its pages: **tested** by `a reading of the log gives no row of a partition past a row of it that
  committed between its statements` and by `a reading of the log gives no row of a partition past a row of it that
  committed between two pages`, in `src/storage.test.ts`, and on a server by `a reading of the log gives no row of a
  partition past one it skipped`, in `src/postgres.test.ts`.
- That a consumer that reads and acks a row of one partition still reads a row of another partition committed after
  it with a lower `position`: **tested** by `a row that commits after one a consumer has read is read then, from its
  partition’s cursor`, in `src/storage.test.ts`.
- That `position` rises with `seq` within a partition on a pool of PostgreSQL, so that a reading may start a partition
  from the lowest `seq` past its cursor: **open**. On SQLite `AUTOINCREMENT` gives each row a rowid larger than any
  before it, **documented** by SQLite. It is the [open question](open-questions.md#storage-and-reading) Orders of the
  storage no test holds.
- That a consumer can act on the order of one entity's rows without an order across entities: **chosen** by
  [decision 0137](decisions/archive/0137-the-log-is-ordered-within-a-partition.md), on what consumers of Kafka are
  promised.
- That a topic is a pure function of the projection, so that two steps that leave the same projection select the same,
  and that a consumer acts on the value of its topic and not on the projection: **chosen** by
  [decision 0138](decisions/archive/0138-the-log-publishes-topics.md) and
  [decision 0140](decisions/archive/0140-a-row-of-a-topic-gives-its-value.md). The library checks no purity, of a topic
  as of `project`.
- That rows sharing a `seq` keep the order of each topic within a partition, and that a topic is read through the
  projection's migrations and the selector of the program deployed: **tested** by `each topic is read alone, through
  the projection's migrations, and a step's rows share its seq`, in `src/storage.test.ts`.
- That a launch with another number of partitions than the database's dies, and names both: **tested** by `a launch
  with another number of partitions than the database’s fails, and names both`, in `src/runtime.test.ts`.
