# Roadmap

The steps from here to a library, in order. The library is the server half of the Elm architecture end to end on
Effect: [effect-tea](https://github.com/fgaudo/effect-tea) in the browser, entities on the server, and one set of
schemas for both. [`review-2026-11.md`](review-2026-11.md) says why the work starts again from the pure core, and
what the owner chose on 2026-11-21. A step that is done leaves this file. The code and the roadmap before the
review are at the tag `pre-restart`. A step keeps its number once another leaves, so that a citation of it stays
true.

Each step names its model and effort, what it depends on, and how to tell it is done. The step to do is the first
of Next whose dependencies have left this file, and that waits for no answer of the owner. The steps that fix bugs
come first, since no feature is built while more than ten bugs are open.

## Next

8. **The questions for the contract.** (Fable 5.2 · high) It depends on steps 6 and 7. The review lists five rules
   of the contract a simpler one may replace, and the slice shows which of them a browser meets. The agent takes
   each or leaves it by the values of `AGENTS.md`, and each one taken changes the machine with its tests. It is
   done when each of the five is taken or left, in a sentence of `docs/design.md`.
   - A rehearsal answers as the runtime does, since step 5 of 2026-11-21. A defect on a caller's message fails the
     rehearsal's `send` with `EntitySuspended`, and its `discard` is the operator's. Either goes with its rule.
   - The slice of step 6, [`examples/seat`](../examples/seat), met two of the five. Its screen may be answered
     `Suspended`, and nothing it reads says the hold is suspended, since `read` gives the last projection. So it
     sends the request again for half a minute, and then shows the old projection with its button. A screen that
     sends one message under each request id cannot cause `Reused`, and still has to handle the answer, so it dies
     on it. The slice did not meet the sender, a `keep` of 0 or U+0000, since a hold takes no sender.

12. **What crosses a boundary has a schema.** (Opus 5.5 · medium) It depends on step 8, which may change the
    answers. The library gives the types `Answer` and `Creation`, and no schema of them, so `api.ts` of
    `examples/seat` writes the union of the five answers by hand. The library gives no schema of an id or of a
    request id either. So the boundary takes any string, the runtime refuses a text no database holds as the
    caller's defect, and a request for the hold `%00` is answered `500`. The step gives, from `./program`, a schema
    of the answers for a program's reasons, and a schema of an id and of a request id. It is done when the example
    writes none of them, and the `test.failing` of the example's `http.test.ts` on that request is a `test`.

13. **A rehearsal gives the handle of its program.** (Opus 5.5 · medium) It depends on step 7. A boundary is
    written on `Handle`, and a rehearsal gives none, since a member's `send` takes no id and no `keep`. So
    `screen.test.ts` of `examples/seat` writes `holdsOf`, the two calls of a handle over one rehearsed hold. The
    step gives a world the handle of a program it runs, with `create`, `send` and `read` at least. It is done when
    the example's rehearsal gives its boundary the world's handle, and `holdsOf` is gone.

14. **A reading that waits for a change.** (Fable 5.2 · high) It depends on step 7. `read` gives the projection
    alone, and no call waits for the next one. So the screen of `examples/seat` reads every second, and shows a
    timer's firing up to a second late. Nothing orders two readings either, so the screen stops reading while a
    message is under way. The entity's `step`, which a row of the outbox already holds, would order them. The step
    decides how a caller waits for a projection past the step it last read, on SQLite and on a pool of PostgreSQL,
    and what wakes the wait where another process stepped the entity. It is done when a test over HTTP sees the
    screen make no request while the projection stands, and `docs/design.md` says what a wait costs.

9. **The documents, from what exists.** (Opus 5.5 · medium) It depends on step 8. `docs/design.md` is written
   again, under 600 lines: the contract first, then how the runtime keeps it. The guide, the README, the glossary
   and `CONTRIBUTING.md` lose what went. The README says the library is the server half of effect-tea, and compares
   it with DBOS Transact and XState's durable execution too. `docs/decisions/`, `docs/premises.md` and
   `docs/rejected.md` are deleted. `docs/cluster.md` stays, as the study the step on several machines begins from.
   A reader checks the guide by the skill `guide-reader`. It is done when `bun run links` and the build of the site
   pass, and no comment cites a note.
   - The design written again keeps its section What is left to you, where `AGENTS.md` sends a rule nothing checks.
   - The browser of `examples/seat` imports no entry of the library. Its schemas are a module of the example that
     imports `effect/Schema` alone, and both programs import that module. The README and `docs/design.md` still say
     that a browser imports a program's module through `./program`. Step 12 gives the browser something to import.
   - The three choices of the slice are in the README of `examples/seat`, and `docs/design.md` says none of them.
   - The doc comment of `send` in `src/rehearse.ts`, and the sentence of `docs/design.md` on a send to an entity
     already suspended, say that its message waits for the resumption. The machine answers `Suspended` and queues
     nothing, as the section on suspension says, and a rehearsal of 2026-11-24 saw it. Both sentences change.

10. **What a deploy may change of a program.** (Fable 5.2 · high) It depends on step 4. It is the rule of bugs 1 and
    96. A table lists each piece a program declares and each way a deploy changes it, against an entity stored
    or suspended, and against a browser that still holds the schemas of the version before. Each case has a test, or
    a sentence that says why it holds. It is done when the table is in `docs/design.md` and the two bugs are
    closed.
    - A deploy activates only the entities with an operation or a message, so a deploy that makes a stored timer an
      operation starts it late. `docs/open-questions.md` asks it under Programs. The runtime's target of the
      histories retries the creation after each deploy, so that the histories do not check it. A rehearsal's
      `restart` and `deploy` step every entity, in `restart` of `src/rehearse.ts`, until this step decides.
    - The screen of `examples/seat` dies on a reading its contract does not decode, and its page asks for a reload.
      It is what a browser that holds the schemas of the version before meets today.
    - The JSON of a key's parameter holds at most 256 bytes, which `keyBy` of `src/machine.ts` checks, since an
      index of PostgreSQL bounds a key. A kind `parameter` of `Migration` meets the same bound.

11. **The release, experimental.** (Opus 5.5 · medium) It depends on steps 9, 10 and 15, and on ten open bugs at
    most. It decides what `exports` names, writes the metadata of `package.json`, and packs the package into a
    project outside Bun that runs and typechecks it. It publishes nothing, since a release is the owner's.
    - No spike sees the runtime on a full volume since the consumers went. A spike of it is owed before the release.
    - `./testing` imports `@effect/sql-sqlite-node`, an optional peer dependency on `node:sqlite`. The project outside
      Bun runs a rehearsal on Node too, at a version that has `node:sqlite` without a flag.
    - The job `release-postgres` of `ci.yml` runs every case of `test:postgres` on a server, by hand. No run of it
      was seen before the owner's push, so the release reads its first run.

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
