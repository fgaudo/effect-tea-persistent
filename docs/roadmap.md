# Roadmap

The steps from here to a library, in order. The library is the server half of the Elm architecture end to end on
Effect: [effect-tea](https://github.com/fgaudo/effect-tea) in the browser, entities on the server, and one set of
schemas for both. [`review-2026-11.md`](review-2026-11.md) says why the work starts again from the pure core, and
what the maintainer chose on 2026-11-21. A step that is done leaves this file. The code and the roadmap before the
review are at the tag `pre-restart`. A step keeps its number once another leaves, so that a citation of it stays
true.

Each step names its model and effort, what it depends on, and how to tell it is done.

## Next

4. **The runtime on the transaction.** (Opus 5.5 · high) It depends on nothing. The spike of step 2 passed on
   2026-11-21. [`spikes/transactional/`](../spikes/transactional) holds it with its tests: a runtime of 590 lines
   on the machine and the storage of today, both unchanged. The spike becomes `src/runtime.ts`, and the histories
   of step 3 are its tests, run on SQLite, on PGlite and on the CI's server of PostgreSQL with a pool.
   `src/rehearse.property.test.ts` goes with the old runtime. It keeps the
   six rules of the review's section Where it must be able to go, and a rule it cannot keep is written here with
   its reason.
   - First `create`, `send`, `read`, the timers, the operations, a suspension and its `resume`, on SQLite.
   - Then entities that talk, with a retry after a wait where a receiver is suspended.
   - Then PostgreSQL: the lock of the entity's row, and a test of two transactions held at a statement for each
     statement that reads another entity's rows.
   - Then `query`, `reindex`, the outbox as one table, `inspect`, `suspended`, `discard` and the sweep.
   - Then the old runtime goes, with the integration of Cluster, the hold, the scheduler of the tests and every
     parked piece.
   - It is done when the histories and the examples pass on the three, the runtime and the storage are under 2,500
     lines without tests, and `bun test` runs within a minute.

   What step 3 left, which this step builds on:
   - `src/machine.test_histories.ts` holds the toy, the histories, the interface `Target` and the checks.
     `src/machine.histories.test.ts` plays them on the machine. Each store adds a `Target` of the runtime. Its
     runner waits for the test's answer, and keeps the answer of each run it started, since a history answers a run
     late. `suspended` reads what an operator reads.
   - An operation started is one a committed step stored, not one whose runner was called, since a crash after the
     commit gives `unknown` with no call.
   - Each check fails once its rule is taken out of the machine. The incarnation that `record` checks has a check of
     its own: without it a late answer stops the run under way, though `holds` drops the answer. `holds` alone is
     found once in about a thousand histories, so the machine plays 10,000.

   What the spike found, which this step keeps or decides:
   - **The process holds the fibers of the operations that run, and no rule rests on anything else in memory.** A
     transaction derives the machine's `running` from the rows and the fibers: a stored timer is armed, and a
     stored operation runs where the process holds its fiber. An operation stored with no fiber is restarted by
     the next transaction of its entity, and by the deploy after a crash. `settled` is no fiber and no timer due.
   - **When an entity is activated is this step's choice.** Activated at each step, a step of a state of 0.5 MB
     took up to 2.0 times today's, over the bound of 1.5. Activated once a launch, it took at most 1.5 times, and
     the spike then remembers the entities it activated. The step chooses a bound for that set, or a mark in the
     entity's row. What is left of the cost is the read of the state, and the projection of the state read, which
     `Machine.writes` computes to compare each topic. `cost.test.ts` holds the numbers.
   - **The crash table loses its last two lines.** A message is handled in the transaction that records it, so a
     process killed between the two stored neither. The operation then runs again or is `unknown`, and the timer
     fires again. `docs/design.md` says so when this step lands.
   - **Two runtimes on one file lose no step, and each restarts the other's operations.** An operation that acts at
     most once is then recorded `unknown` while it still runs, and is never run twice. Who runs an operation is
     the claim the step under Later decides.
   - **Of the review's six rules** the spike keeps the first, the third for a request, and the fourth. It breaks
     the second where the storage of today does, and in no place of its own. It does not reach a sweep, the fifth
     or the sixth. A step calls seven functions of the storage: `load`, `reply`, `write`, `answer`, `keepAnswer`,
     `due` and `interrupted`.
   - **The examples' tests run as they are** on a runtime under way, by the preload of `examples.preload.ts`.
     `examples/subscription` has no test on a runtime, and every test of `examples/order` uses a parked piece or
     a reading of the read model, which the spike took from the storage.
   - The spike did not try PostgreSQL, a pool, a deploy of a changed program, or a receiver resumed while a sender
     waits.

5. **The rehearsal on the runtime's step.** (Opus 5.5 · high) It depends on step 4. The rehearsal of today is not
   a target of the histories: it fails a test at a defect, and has no `resume` and no `discard`. The maintainer chose
   the machine on 2026-11-21, and `docs/open-questions.md` asks whether a rehearsal shows a suspension. `rehearse` runs the step of
   step 4 on a store in memory, with the test's clock and the test's answers, and reads what it stored back through
   the migrations. The histories of step 3 run on the runtime's target over both stores, and must agree. It is done
   when bugs 5, 107, 108 and
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
