# What was weighed, and rejected

An idea listed here was weighed for the design and rejected. A proposal reads this file first, so that an idea is not
proposed again as new. An entry is not a ban. It is reopened by bringing what it names under "Reopen if", or a
reason it does not answer, and the proposal says so.

The list is written area by area, by the step The rules move from the notes into documents kept true, of the
[roadmap](roadmap.md). Until that step is done, the alternatives of the areas not moved yet are in their notes.

## How an entry is written

- An entry says what the idea was, why it was rejected, and on what evidence. **Spiked** means code was written and
  run, and names where. **Weighed** means it was decided by reading and argument.
- An entry says what would reopen it, under "Reopen if".
- An entry links the record that weighed it, in [`decisions/`](decisions), where its full account is.

## The tables of versions

- **A version of the runner carried by Cluster's own structures.** Weighed, 2026-11-07, in
  [decision 0159](decisions/archive/0159-on-cluster-an-older-version-serves-no-shard-once-a-newer-one-launches.md). A
  `Runner` has no field for a version. A shard group per version would be part of every entity's address, so a deploy
  would move every address and leave the stored messages under the old one. `runnerShardWeight` is read once, as a
  runner starts. `ClusterSchema.InterruptOnTermination` waits for the entity to end, inside a transaction that holds
  the runner's one connection of SQLite. `RunnerHealth` is used instead. Reopen if: a release of Cluster gives a
  runner a version, or a fence of its own.
- **A deploy that replaces every runner before a new one writes.** Weighed in decision 0159. It is safe, but stops
  every shard for the length of the deploy, where the rule stops only the older runners' steps. Reopen if: a
  deployment cannot run two versions at once for another reason.
- **Forward compatibility for one version.** Weighed in decision 0159. Every program would read the rows of the
  version after it, which its migrations cannot say, since a migration reads an older row and never a newer one.
  Reopen if: migrations come to describe a newer row too.
- **The health check alone.** Spiked in
  [`spikes/cluster-unhealthy-runner-gives-up-its-shards.test.ts`](../spikes/cluster-unhealthy-runner-gives-up-its-shards.test.ts),
  decision 0159. An older runner started again holds shards until the next health check, a minute by default.
  Reopen if: Cluster stops a runner that is not alive from registering itself.
- **The check by the commit alone.** Weighed in decision 0159. It loses nothing, but the older runners keep their
  share of the shards, and every one of their steps dies until they stop. Reopen if: the health check costs more
  than the steps that die.
- **A launch on Cluster that dies where it renames.** Weighed, 2026-11-07, in
  [decision 0176](decisions/archive/0176-on-cluster-a-rename-marks-the-old-name-and-keeps-its-door.md). It is a guard of
  a few lines, which keeps every application on Cluster from renaming a program. Reopen if: the door of an old name
  costs more than renaming is worth.
- **A rename that writes Cluster's tables.** Weighed in decision 0176. It must write the entity type into
  `message_id`, and digest it as Cluster does, which are Cluster's own and promised by no release. Reopen if: Cluster
  documents its tables, or gives a rename of an entity type.
- **A rename that waits until the old name's requests are delivered.** Weighed in decision 0176. A client of the old
  code keeps sending, so the wait has no end, and it blocks the launch. Reopen if: a launch can stop every client of
  the old code first.
- **A table of its own for the mark of a renamed name.** Weighed in decision 0176. A step reads the program's row of
  `effecttea_versions` already, `FOR SHARE` on PostgreSQL, so a column of that row is read in the same statement and
  locked with it. Reopen if: the mark needs more than one name.

## The tables of Cluster's requests

- **Cluster's own retention of processed requests, `deleteProcessed` or `MessageRetention`.** Weighed, 2026-11-07,
  in [decision 0169](decisions/archive/0169-on-cluster-an-operations-request-ids-are-kept-under-its-work-and-deleted-with-it.md)
  and [decision 0171](decisions/archive/0171-on-cluster-a-callers-rows-go-once-its-client-has-the-answer-and-its-time-is-past.md),
  before a release held it, and again in
  [decision 0245](decisions/archive/0245-a-reply-is-kept-as-long-as-send-says-and-the-runtime-sweeps.md). It deletes by
  entity type and time, so it spares neither an operation's request ids kept under its work, nor a caller's rows its
  client has not read. Reopen if: Cluster's retention takes the requests to spare.
- **`MessageStorage.clearReplies` or `Sharding.reset` to forget a request.** Weighed in decisions 0090, 0169 and 0171.
  Each marks the request unprocessed, and Cluster delivers it again. Reopen if: Cluster gives an operation that
  forgets a processed request without delivering it.
- **`MessageStorage.clearAddress`.** Weighed in decisions 0169 and 0171. It deletes every row of an entity, the
  requests that still wait among them. Reopen if: it takes the requests to delete.
- **Cluster's rows deleted in `afterCommit`.** Weighed in
  [decision 0090](decisions/archive/0090-on-cluster-a-reply-is-deleted-as-on-one-process.md) and decision 0169. A crash
  between the commit and the deletion keeps the rows for ever, where a deletion in the step's transaction keeps none.
  Reopen if: a statement in the step's transaction costs more than the rows a crash leaves.
- **The Cluster ids kept beside the runtime's replies.** Weighed in decisions 0090 and 0169. A request answered
  `Suspended` or `NotFound` has no reply, so its rows would stay once its asker's work ended. Reopen if: every answer
  comes to be stored as a reply.
- **The door's step keeping a caller's id with the reply.** Weighed in decision 0171, which replaced it. The step's
  deletion past the reply's time takes the reply of a client on another runner that has not read it, and of every
  message with a `keep` of 0. Reopen if: Cluster records that every client of a request read its reply.
- **The step's own request left pending, and deleted by the next step.** Weighed in decision 0171. The next step of
  any entity can come before a client on another runner reads the reply. Reopen if: Cluster records that every
  client of a request read its reply.
- **The client deleting Cluster's rows itself once it has the answer.** Weighed in decision 0171, and for an
  operator's event in [decision 0290](decisions/archive/0290-on-cluster-an-operators-client-keeps-the-id-the-doors-answer-carries.md).
  A caller's retry before its `keep` is past would be a new request to Cluster, and stepped, where Cluster answers it
  from the reply saved. An operator's event has one client, so the deletion would be safe there, but it is a second
  way to delete Cluster's rows, for no gain. Reopen if: a client's deletion replaces the step's and `expire`'s.
- **A margin of another size.** Weighed in decision 0171 and in
  [decision 0248](decisions/archive/0248-on-cluster-a-callers-rows-are-kept-for-every-clients-poll.md). A margin with no
  poll in it is wrong for a runner launched with a long poll. One poll leaves no room for the read, nor for a read that
  failed. No margin holds for a runner paused longer than it, in a collection of its memory or a partition of its
  network. Reopen if: Cluster tells a client that its rows are gone, or the least time takes the longest poll of the
  runners, as bug 89 of [`bugs.md`](bugs.md) asks.
- **A creation's id kept for ever, or for a day.** Weighed in decision 0248. Every creation's rows would add up in
  Cluster's tables, which decision 0245 freed them from. Reopen if: a retry of a creation must be answered by
  Cluster's saved reply past the least time.
- **The second client given up, and retried by its caller.** Weighed in decision 0248. A caller does not know that its
  client waits on a reply that is gone, and a caller with no timeout would wait for ever. Reopen if: Cluster's client
  fails a wait whose rows are gone.
- **Cluster's rows deleted only by the sweep.** Weighed in decision 0248. A step would still delete the rows of a
  `keep` past, and the sweep runs at any time after the answer. Reopen if: a step no longer deletes Cluster's rows.
- **An id kept only for an answer that is a reply.** Weighed in
  [decision 0249](decisions/archive/0249-on-cluster-a-reset-drops-the-id-a-callers-client-kept.md). A caller answered
  `Suspended`, `NotFound` or `Rejected` that never retries would leave its rows in Cluster's tables for ever. Reopen
  if: such rows are deleted another way.
- **A keep that renews the time of an id already kept.** Weighed in decision 0249. The first answer's time would still
  be past between the reset and the delivery, and the step that answers the retry would delete its own request.
  Reopen if: a reset and its delivery come in one transaction.
- **A step and `expire` that skip a request Cluster has not marked processed.** Weighed in decision 0249. They would
  read Cluster's column `processed`, which no promise of Cluster names. Reopen if: Cluster documents the column, or
  gives a reading of a request's state.
- **The operator's id kept by the door's step, with the least time.** Weighed in decision 0290. The time would count
  from the step's start, before the commit and before the client's poll, so a slow commit could delete a reply that
  a client on another runner has not read. It would also keep the id of an operator that stops waiting. Reopen if:
  Cluster records that every client of a request read its reply.
- **A primary key drawn for each operator's event, so that its client finds the id as a caller's does.** Weighed in
  decision 0290. It changes the payload of the door and the rule that each event is a request of its own. It would
  also find the id of a failure Cluster saved without running the handler. Reopen if: the door's payload changes for
  another reason.
- **A creation the program dies on stored as an entity suspended at its creation**, and Cluster's message freed.
  Weighed, 2026-11-13, in [decision 0291](decisions/archive/0291-on-cluster-a-creation-the-program-dies-on-is-answered-died-and-reset.md),
  after decisions 0182 and 0253 refused it for a `Rejected`. It makes an entity that does not exist, whose rows
  `load`, the queries and `AlreadyExists` must skip, and it departs from one process, where the sender is suspended.
  Reopen if: one process comes to store such an entity too.
- **A creation the program dies on that waits for a fix**, as decision 0160 had it, with the waiting creation shown
  to an operator. Weighed in decision 0291, which replaced it. An operation's sender stayed busy and never suspended,
  and another creator of the id waited behind it for ever, which were bugs 10 and 58. Reopen if: Cluster gives a
  creation a backoff of its own that lets the requests behind it through.
- **`Died` for an operation's creation alone, and the wait for a fix kept for a caller's.** Weighed in decision 0291.
  It keeps bug 58 for a caller, and a mark of Cluster's in the test of a contract. Reopen if: a caller on one
  process comes to wait for a fix too.

## The tables of replies

- **A default `keep` of a day.** Weighed, 2026-11-10, in
  [decision 0245](decisions/archive/0245-a-reply-is-kept-as-long-as-send-says-and-the-runtime-sweeps.md). It ends the growth
  of the replies without a change to every call, but a retry after a day is applied twice without the boundary having
  chosen it. Reopen if: a protocol of retries comes to be known to the library.
- **A sweep left off by default.** Weighed in decision 0245. A deployment whose operator does not know of it grows as
  before. Reopen if: a sweep comes to change what a step answers.
- **Every runner of Cluster sweeps.** Weighed in decision 0245. It is simpler, but the runners contend for the same
  rows, and `expire` is one statement over a whole program. Reopen if: Cluster's singletons cost more than the
  contention.
- **`create`'s flags left positional, and written `null`.** Weighed in decision 0245, where a Fable 5.2 agent advised
  it, and the maintainer chose to move the flags into the request. Reopen if: the request of `create` comes to hold
  nothing a caller may leave out.
- **The rehearsal's sender left positional, left out only where it is `null`.** Weighed in decision 0245. A test that
  names a request id would still write `null` before it. Reopen if: a rehearsal's `send` takes no request id.
- **An operation's `create` left with its flags before the name.** Weighed in decision 0245. No operation then created
  an entity whose flags are `null`, but a later change breaks every program that creates from an operation, so the
  maintainer applied the rule before the first release. Reopen if: never, once a release holds the signature.
- **The design narrows its promise on a run after a crash**, and says that a `Rejected` of `init` and a `NotFound` may
  differ there. Weighed, 2026-11-11, in
  [decision 0253](decisions/archive/0253-an-answer-no-entity-stores-is-kept-for-the-operation-that-was-given-it.md). It
  changes no code, but every program that creates or sends from an operation carries the rule, and an operation that
  talks only to entities no longer acts once. Reopen if: the room of `effecttea_answers` costs more than the promise.
- **A rejected id keeps a row at the receiver.** Weighed in decision 0253. A rejected creation would leave something,
  and another creator could no longer create the id, which decision 0182 rejected. Reopen if: a rejected creation
  comes to be stored.
- **The answers kept in `effecttea_replies`.** Weighed in decision 0253. That table keys a reply by the request's text
  alone, so an operation's creation and message under one name would share a row. Reopen if: the table of replies
  comes to key its rows by the kind of request.
- **The list of who waits read from the senders the process registered**, narrowed to the operations that run.
  Weighed, 2026-11-11, in
  [decision 0265](decisions/archive/0265-the-operations-that-wait-for-a-resumption-are-stored-by-the-step-that-answers.md),
  which replaced decision 0114 on this point. On Cluster the runners would answer differently, and an operator would
  lose, at each restart, that an entity waits for another. Reopen if: a wait comes to cost more than an operator's
  view of it.
- **A restarted process starts the operations of suspended entities.** Weighed in decision 0265. It would run the
  program deployed against a state only `resume` may activate, could not reach an entity suspended on its activation,
  and would run again the operation an entity died in. Reopen if: never, while a suspension waits for an operator.
- **A wait of a run that ended deleted by the step that ends it.** Weighed in decision 0265. The reading already leaves
  such a row out, and the suspension's end deletes it, so the deletion would be a second rule for the same rows.
  Reopen if: such rows come to be many.
- **The contract alone, for a request id reused for another message.** Weighed, 2026-11-12, in
  [decision 0269](decisions/archive/0269-a-callers-request-is-its-sender-its-id-and-what-it-carries.md). The design says that
  a program whose sender is `null` keeps one space of request ids, but alone it keeps a silent loss for every caller
  that breaks the rule by mistake. Reopen if: the room of what a request carries costs more than the check.
- **A sender required wherever a program takes inbound messages.** Weighed in decision 0269. A sender written alike for
  every caller, and two devices of one identity, would keep the loss, and a program with no identity would invent a
  sender. Reopen if: no program without a sender takes messages.
- **A hash of the message instead of its text.** Weighed in decision 0269. No migration reads a hash, so a retry
  after a deploy that changes the message's form would be answered `Reused`. Reopen if: migrations come to be given
  the value and not the JSON.
- **`Reused` as the caller's defect.** Weighed in decision 0269. A defect is the code's, and a caller outside the
  library causes `Reused`. Reopen if: a defect comes to name the caller's code.
- **The check of what a request carries on an operation's requests too.** Weighed in decision 0269, as decision 0047
  had. An operation's request never holds two intents, so the check would find only a run after a crash or a deploy
  that built its message otherwise, and the operation would be answered `Reused` or die into the same mismatch at
  each resume. Reopen if: two intents come to share an operation's request.
- **A second caller joined to a caller still registered, with nothing offered.** Weighed, 2026-11-12, in
  [decision 0282](decisions/archive/0282-a-callers-message-offered-before-its-answer-is-answered-by-it.md). It fails a retry
  sent after the first caller gave up, as a Fable 5.2 agent reproduced, and a caller joined so would pass the bound of
  callers' messages. Reopen if: a first `Receive` comes to leave its queue when its caller gives up.
- **A reply kept for the runtime's reading for a least time beside its `keep`.** Weighed in decision 0282. It holds by
  a margin, which a long mailbox outlasts. Reopen if: a mailbox comes to have a bound in time.
- **A `keep` below a least one refused.** Weighed in decision 0282. A retry that waits behind a slow step outlasts any
  least `keep`, and the tests of the sweep rely on a `keep` of 0. Reopen if: a step comes to have a bound in time.
- **Effect's `Cache` to join callers.** Weighed in decision 0282. It shares lookups made at once, but the answer here
  comes from the entity's step and its commit, and the process's map of callers is already the join. Reopen if: a
  module of Effect joins waiters on an answer another fiber gives.
- **The time in the outer `WHERE` of a batch's `DELETE`.** Weighed, 2026-11-12, in
  [decision 0285](decisions/archive/0285-a-batch-of-expire-skips-the-replies-a-step-holds.md). PostgreSQL reads that `WHERE`
  again on the row committed, so it fixes the case too, but it keeps a guard where decision 0284 says a condition is
  read from a row locked, and leaves the batch waiting for every step that holds a row. Reopen if: decision 0284's
  rule changes.
- **`FOR UPDATE` that waits, in a batch of `expire`.** Weighed in decision 0285. It reads the row committed too, and
  makes a sweep wait for the steps, which bug 49 deadlocked. Reopen if: a batch comes to hold no row while it waits.
- **The receiver locks the asker's key `FOR SHARE` before it stores a reply or an answer.** Weighed, 2026-11-12, in
  [decision 0289](decisions/archive/0289-expire-deletes-what-work-that-ended-was-given.md). The row would go at once, but a
  receiver's step would wait for an asker's, two entities that answer each other in one step would close a cycle,
  and every step would lock every key it writes, in one order. Reopen if: a row left until the next sweep comes to
  cost a wrong answer.
- **A trigger, or a check deferred to the commit.** Weighed in decision 0289. Each reads the same snapshot, and splits
  the dialects. Reopen if: both dialects come to give a check that reads what is committed at the commit.
