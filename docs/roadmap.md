# Roadmap

The steps from here to a library, in order. The library is the server half of the Elm architecture end to end on
Effect: [effect-tea](https://github.com/fgaudo/effect-tea) in the browser, entities on the server, and one set of
schemas for both. [`review-2026-11.md`](review-2026-11.md) says why the work starts again from the pure core, and
what the maintainer chose on 2026-11-21. A step that is done leaves this file. The code and the roadmap before the
review are at the tag `pre-restart`. A step keeps its number once another leaves, so that a citation of it stays
true.

Each step names its model and effort, what it depends on, and how to tell it is done.

## Next

6. **A slice from the browser to the entity.** (Fable 5.2 · high) It depends on step 4. It is the library's
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

7. **The bugs and the questions are read again.** (Opus 5.5 · medium) It depends on nothing. Each entry of
   `docs/bugs.md` and `docs/open-questions.md` is gone with its piece, held by a test, or still open. It is done
   when both files hold only what is open, and every open bug has a failing test.
   - `docs/open-questions.md` still links to removed code at the tag `pre-restart`.
   - A reply or a `NotFound` stored while the asker's work ends is left on PostgreSQL. Neither step waits for the
     other, and each misses the other's write. The four overlaps of `src/runtime.pool.test.ts` check that `expire`
     deletes the row.

8. **The questions for the contract.** (Fable 5.2 · high) It depends on steps 6 and 7. The review lists five rules
   of the contract a simpler one may replace, and the slice shows which of them a browser meets. The maintainer
   takes each or leaves it, and each one taken changes the machine with its tests. It is done when each of the five
   is taken or left, in a sentence of `docs/design.md`.
   - A rehearsal answers as the runtime does, since step 5 of 2026-11-21. A defect on a caller's message fails the
     rehearsal's `send` with `EntitySuspended`, and its `discard` is the operator's. Either goes with its rule.

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
    - A deploy activates only the entities with an operation or a message, so a deploy that makes a stored timer an
      operation starts it late. `docs/open-questions.md` asks it under Programs. The runtime's target of the
      histories retries the creation after each deploy, so that the histories do not check it. A rehearsal's
      `restart` and `deploy` step every entity, in `restart` of `src/rehearse.ts`, until this step decides.

11. **The release, experimental.** (Opus 5.5 · medium) It depends on steps 9 and 10, and on ten open bugs at most.
    It decides what `exports` names, writes the metadata of `package.json`, and packs the package into a project
    outside Bun that runs and typechecks it.
    - No spike sees the runtime on a full volume since the consumers went. A spike of it is owed before the release.
    - `./testing` imports `@effect/sql-sqlite-node`, an optional peer dependency on `node:sqlite`. The project outside
      Bun runs a rehearsal on Node too, at a version that has `node:sqlite` without a flag.

## Later

- **Several machines, on Effect Cluster and PostgreSQL.** (Fable 5.2 · high) It depends on the release, and it is
  why Cluster was asked for. Cluster assigns the shards, and a shard's runner runs the operations of the shard's
  entities and fires their timers. The step's own transaction is the fence, so the step waits for no change of
  Cluster. Nothing of the library's is persisted in Cluster, and no statement of the library reads Cluster's
  tables. The step decides three things: how an operation that acts at most once is claimed, which version of a
  program steps a row during a rolling deploy, and whether a request is routed to the shard's runner or stepped
  where it arrives. A planned stop comes back with it. It begins from [`cluster.md`](cluster.md) and decision 0162.
  It is done when two runners on two connections of the CI's server pass the histories of step 3, with a runner
  killed and a shard moved during them. Of the review's six rules the runtime of one machine keeps the first, the
  third for a request, and the fourth. It breaks the second where the storage does, and in no place of its own.
- **Several databases.** It is not planned, and no step builds it until an application needs it. It stays possible
  while a step's transaction writes its own entity's rows alone, the second rule of the review's section Where it
  must be able to go.

## Parked

Step 4 took each piece out, and git keeps it at `pre-restart`. A piece comes back as a step of this file,
once what it waits for holds.

- **The consumers of the log**: topics by reader, partitions, cursors, `fetch`, `consume`, `prune`. They wait for a
  user that reads the outbox with more than its own SQL. They come back as a module of their own.
- **`count`, `sum` and `countBy`.** They wait for a question an application cannot ask of the table of projections.
- **Renames.** They wait for a user that renames a program.
- **The planned stop.** It comes back with several machines.
- **The spans and the metrics.** They wait for the release.
