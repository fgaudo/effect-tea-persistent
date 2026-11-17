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
