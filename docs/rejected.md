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
