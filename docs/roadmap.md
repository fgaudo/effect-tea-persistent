# Roadmap

The steps from here to a library, in order. The library is the server half of the Elm architecture end to end on
Effect: [effect-tea](https://github.com/fgaudo/effect-tea) in the browser, entities on the server, and one set of
schemas for both. [`review-2026-11.md`](review-2026-11.md) says why the work starts again from the pure core, and
what the maintainer chose on 2026-11-21. A step that is done leaves this file. The roadmap before the review is in
git, at the commit before the review.

Each step names its model and effort, what it depends on, and how to tell it is done.

## Next

1. **The old method is frozen.** (Opus 5.5 · medium) It depends on nothing.
   - The commit before it is tagged `pre-restart`.
   - The four steps under way stop, and their notes stay `proposed` as they are. The move of the rules into
     documents, decision 0294, stops after area 6. The tests of a contract, decision 0283, keep
     `src/contract.test.ts` as it is. The order of two timers, decision 0293, keeps `nextTimer` of `src/machine.ts`,
     and its second part is not written. The pure core of the process, decision 0292, is not started.
   - No note is added, moved or edited. A comment keeps its citation until its code is written again.
   - [`AGENTS.md`](../AGENTS.md) is written again, under 120 lines. Its new rules are the review's section The rules
     of work proposed. Its rules of today on language, commits and prose stay, but those on the citation of a note.
     Of its rules on code and tests, these stay: how the examples and the fixtures import, the name of a file only
     tests import, the look for a module of Effect before code is written by hand, `src/machine.ts` as the semantics
     with a test for each rule, the jobs of the CI, the pins of Bun and of Effect's packages, the glossary, the
     diagrams, the site and the READMEs of the examples. The section on notes goes whole, with the rules on the
     scheduler of the tests, the pinned seeds and the mutations.
   - `AGENTS.md` also says that the old runtime is frozen. Until step 4 takes them out, `src/runtime.ts`,
     `src/runtime/`, `src/cluster.ts`, `src/storage/cluster.ts` and `src/testing.ts` change only to be removed.
   - `src/form.test.ts` loses the checks of a note's form and of a premise. The skill `premise-review`,
     `scripts/premise-pairs.ts` and `scripts/archive-notes.ts` go.
   - It is done when `bun test`, `bun run typecheck` and `bun run links` pass, and `AGENTS.md` is under its budget.

2. **A spike of the runtime on the transaction.** (Fable 5.2 · high) It depends on nothing, and may run beside
   step 1. It is the test of the review's first finding, before anything is deleted. A runtime of at most 600 lines,
   in `spikes/transactional/`, keeps one rule: every event is one transaction that reads the entity under a lock,
   steps `Machine.step` from what it read, and writes. It passes when all of these hold on SQLite.
   - It runs `src/machine.ts` as it is, or with changes it lists, each small.
   - The runtime tests of `examples/quick-start`, `examples/subscription`, `examples/booking` and `examples/rental`
     pass on it, and those of `examples/order` that use no parked piece.
   - Two runtimes on one file lose no step, in a test that fails on the runtime of today.
   - A process killed at each line of the table What survives a crash of `docs/design.md` ends where the machine
     ends.
   - A step takes at most half as long again as today's, on the states of `spikes/large-states.test.ts`.
   - It is done when this file says whether it passed, and what it found. It says of each rule of the review's
     section Where it must be able to go whether the spike keeps it, breaks it or does not reach it. It fails where
     the machine needs state in memory that `Restart` cannot give back inside a step's transaction, or where an
     operation that acts at most once is run twice.

3. **Histories with invariants, on the rehearsal.** (Opus 5.5 · high) It depends on nothing, and may run beside
   step 2. fast-check generates histories: a message under a new request id or a retried one, an operation that
   completes or dies, time that passes, a restart, a resume and a discard. After each history the test checks the
   promises of the design. A message under a request id is applied at most once, and a retry is given the same
   reply. An operation that acts at most once is given `unknown` only where it started. No answer of an earlier
   incarnation is delivered. It begins beside `src/rehearse.property.test.ts`. It is done when the property passes,
   and each invariant fails once its rule is taken out of the machine by hand.

4. **The runtime on the transaction.** (Opus 5.5 · high) It depends on steps 2 and 3. The spike becomes
   `src/runtime.ts`, and the histories of step 3 are its tests, run on SQLite, on PGlite and on the CI's server of
   PostgreSQL with a pool. It keeps the six rules of the review's section Where it must be able to go, and a rule
   it cannot keep is written here with its reason.
   - First `create`, `send`, `read`, the timers, the operations, a suspension and its `resume`, on SQLite.
   - Then entities that talk, with a retry after a wait where a receiver is suspended.
   - Then PostgreSQL: the lock of the entity's row, and a test of two transactions held at a statement for each
     statement that reads another entity's rows.
   - Then `query`, `reindex`, the outbox as one table, `inspect`, `suspended`, `discard` and the sweep.
   - Then the old runtime goes, with the integration of Cluster, the hold, the scheduler of the tests and every
     parked piece.
   - It is done when the histories and the examples pass on the three, the runtime and the storage are under 2,500
     lines without tests, and `bun test` runs within a minute.

5. **The rehearsal on the runtime's step.** (Opus 5.5 · high) It depends on step 4. `rehearse` runs the step of
   step 4 on a store in memory, with the test's clock and the test's answers, and reads what it stored back through
   the migrations. The histories of step 3 run on both stores and must agree. It is done when bugs 5, 107, 108 and
   112 of `docs/bugs.md` each have a test that passes.

6. **A slice from the browser to the entity.** (Fable 5.2 · high) It depends on steps 4 and 5. It is the library's
   first application, and it says what the backend lacks. It is one example, the seat of `examples/quick-start`
   with an interface. A program of effect-tea in the browser and the entity on the server import one module of
   schemas. In the browser a message to the entity is a command, and the entity's projection is a subscription
   under the entity's id. The interface shows the projection, sends `Confirm`, and shows the seat released once the
   timer fires. The step decides three things, each by the smallest way that works: how the browser follows a
   projection, how a boundary is made from a program's schemas, and where the code between the two lives. It builds
   no framework.
   - It is done when a test runs the flow over HTTP on the launched runtime. A second test rehearses the two
     programs together with no browser, server or database, or this file says what a rehearsal of both lacks.
   - It writes here, as steps, what the slice asked of the backend and did not find.

7. **The bugs and the questions are read again.** (Opus 5.5 · medium) It depends on step 5. Each entry of
   `docs/bugs.md` and `docs/open-questions.md` is gone with its piece, held by a test, or still open. It is done
   when both files hold only what is open, and every open bug has a failing test.

8. **The questions for the contract.** (Fable 5.2 · high) It depends on steps 6 and 7. The review lists five rules
   of the contract a simpler one may replace, and the slice shows which of them a browser meets. The maintainer
   takes each or leaves it, and each one taken changes the machine with its tests. It is done when each of the five
   is taken or left, in a sentence of `docs/design.md`.

9. **The documents, from what exists.** (Opus 5.5 · medium) It depends on step 8. `docs/design.md` is written
   again, under 600 lines: the contract first, then how the runtime keeps it. The guide, the README, the glossary
   and `CONTRIBUTING.md` lose what went. The README says the library is the server half of effect-tea, and compares
   it with DBOS Transact and XState's durable execution too. `docs/decisions/`, `docs/premises.md` and
   `docs/rejected.md` are deleted. `docs/cluster.md` stays, as the study the step on several machines begins from.
   A reader checks the guide by the skill `guide-reader`. It is done when `bun run links` and the build of the site
   pass, and no comment cites a note.

10. **What a deploy may change of a program.** (Fable 5.2 · high) It depends on step 4. It is the rule of bugs 1, 7
    and 96. A table lists each piece a program declares and each way a deploy changes it, against an entity stored
    or suspended, and against a browser that still holds the schemas of the version before. Each case has a test, or
    a sentence that says why it holds. It is done when the table is in `docs/design.md` and the three bugs are
    closed.

11. **The release, experimental.** (Opus 5.5 · medium) It depends on steps 9 and 10, and on ten open bugs at most.
    It decides what `exports` names, writes the metadata of `package.json`, and packs the package into a project
    outside Bun that runs and typechecks it.

### If the spike fails

These replace steps 4 and 5, and the steps after them stand.

- **The integration of Cluster is taken out of the runtime as it is.** (Opus 5.5 · high) The doors,
  `src/cluster.ts`, Cluster's tables and each branch that reads `cluster` go. It is done when
  `bun run test:release` passes. How Cluster comes back is decided anew, since the step under Later rests on the spike.
- **The process's state as a pure core.** (Fable 5.2 · high) It is the step of decision 0292, as git keeps it.

## Later

- **Several machines, on Effect Cluster and PostgreSQL.** (Fable 5.2 · high) It depends on the release, and it is
  why Cluster was asked for. Cluster assigns the shards, and a shard's runner runs the operations of the shard's
  entities and fires their timers. The step's own transaction is the fence, so the step waits for no change of
  Cluster. Nothing of the library's is persisted in Cluster, and no statement of the library reads Cluster's
  tables. The step decides three things: how an operation that acts at most once is claimed, which version of a
  program steps a row during a rolling deploy, and whether a request is routed to the shard's runner or stepped
  where it arrives. A planned stop comes back with it. It begins from [`cluster.md`](cluster.md) and decision 0162.
  It is done when two runners on two connections of the CI's server pass the histories of step 3, with a runner
  killed and a shard moved during them.
- **Several databases.** It is not planned, and no step builds it until an application needs it. It stays possible
  while a step's transaction writes its own entity's rows alone, the second rule of the review's section Where it
  must be able to go.

## Parked

Each piece is taken out by step 4, and git keeps it at `pre-restart`. A piece comes back as a step of this file,
once what it waits for holds.

- **The consumers of the log**: topics by reader, partitions, cursors, `fetch`, `consume`, `prune`. They wait for a
  user that reads the outbox with more than its own SQL. They come back as a module of their own.
- **`count`, `sum` and `countBy`.** They wait for a question an application cannot ask of the table of projections.
- **Renames.** They wait for a user that renames a program.
- **The planned stop.** It comes back with several machines.
- **The spans and the metrics.** They wait for the release.
