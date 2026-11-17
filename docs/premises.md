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
