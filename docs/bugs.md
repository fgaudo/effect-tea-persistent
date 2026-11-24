# Bugs

The bugs open on `main`, by number. A document cites a bug by its number, as `bug 96`. A number is never given
again, so a bug that leaves this file leaves a gap in the list. Git keeps the bugs that left, and the tag
`pre-restart` keeps the list as it was before the restart.

## How a bug is kept

- Each bug has a `test.failing` on `main`, named in its entry, so that `bun test` passes while the bug holds and fails
  once a change fixes it. The fix makes that test a `test`.
- The agent that fixes a bug chooses its fix by the values of [`AGENTS.md`](../AGENTS.md), and says the choice in a
  line of the commit.
- A bug fixed leaves this file in the commit of its fix. A bug whose piece of the library goes leaves with it.
- A bug found is added at the end, under the next number. The next number is 124.

## The list

- **1. A droppable operation that a new program delivers at most once never runs.** `renew` of `src/machine.ts`
  keeps the incarnation of an operation that is the same work under another delivery. `activate` then reads that
  incarnation as an at-most-once run that may have acted, and records its `unknown` instead of starting it. The run
  stopped was droppable, so it acted on nothing. A program that answers `unknown` by not acting again never acts. The
  test is `a droppable operation a new program delivers at most once starts, since it acted on nothing`, in
  `src/machine.test.ts`. The fix begins at `activate`, which would give `unknown` only to an incarnation stored as run
  at most once, or at `renew`, which would draw a new incarnation for a droppable operation delivered otherwise. It is
  a case of step 10 of the [roadmap](roadmap.md).
- **95. `check` dies whole on a migration of the flags that throws, where it should name the entity as a `Load`.**
  `entity` of `src/storage/entities.ts` runs the migrations of the flags outside its guard, and those of the state
  inside it. So a migration of the flags that throws on a stored row fails the whole `check`, which lists no entity.
  A deploy dies on the entity, so only `check` is wrong. The test is `a migration of the flags that dies on a stored
  row is a Load of its entity, as one of the state is`, in `src/check.test.ts`. The fix reads the flags inside
  `guard`, as `entity` reads the creation's request.
- **96. A deploy that changes how a key's parameter encodes suspends every entity with work under way under that
  key.** A key's parameter is stored as its schema encodes it, in `effecttea_entity_keys`, in the mailbox's internal
  messages, and in the askers of the replies and the answers. No kind of `Migration` of `src/program.ts` reads it. So
  version 1 starts an operation under `charge` with the parameter `'a'`, version 2 declares the parameter as
  `{ line: string }`, and the activation finds the stored operation dropped. A timer under such a key would be armed
  again in a new incarnation, and an idempotency key drawn from the parameter would change. The test is `a deploy
  whose key parameter encodes otherwise keeps the operation under way under its key`, in `src/machine.test.ts`, and
  it was not run through the runtime. The fix is step 10 of the [roadmap](roadmap.md): a kind `parameter` of
  `Migration`, or a rule that a deploy keeps a parameter's encoding while work is under way under it, which `check`
  reports.
- **99. The comparison of a move of Effect does not compare the source of `Migrator`, which the launch rests on.**
  `createTables` of `src/storage/tables.ts` runs Effect's `Migrator`. Two launches at once are safe because `run` of
  `sql/Migrator.ts` takes its lock before it reads the history, and because a unique violation on the history is read
  as `Locked`. `scripts/compare-docs.ts` compares whole the sources of the drivers, and leaves out `sql/Migrator.ts`,
  a module `@stability unstable`. So a release of Effect that reads the history before the lock passes every check.
  The script still lists the declarations and the sources of Cluster too, which nothing of `src/` rests on since the
  restart. The test is `the comparison of a move of Effect compares whole the source of Migrator, which the launch
  rests on`, in `src/form.test.ts`. The fix names `sql/Migrator.ts` among the sources the script compares whole, and
  takes Cluster out of its lists.
- **102. On PostgreSQL, a step whose id, index or request holds a long text cannot be written, where SQLite writes
  it.** An entry of a B-tree index of PostgreSQL holds 2,704 bytes at most, once compressed, and SQLite holds any text
  in a key or an index. An entity is keyed by its id, a reply by the text of its request, a key by its parameter's
  JSON, and an index of the read model is an expression index. So a statement fails on PostgreSQL for an id, a
  request, a parameter or a string index of a few kilobytes that compress little. Bugs 103 and 105 are what this
  failure does to `reindex` and to a step. The test is `a step whose id, index or request holds a long text is
  written alike on both dialects`, in `src/storage.test.ts`, and it fails on PGlite for each of the three. The fix
  begins at `shownOf` of `src/machine.ts` and at the checks of a caller's id and request, which would refuse a text
  past a bound on both dialects, as `shownOf` refuses an index that is no scalar. Another fix keys the storage by a
  digest of the text, and keeps the text beside it.
- **103. On PostgreSQL, `reindex` dies whole at an entity whose new index it cannot write.** `reindex` of
  `src/storage/projections.ts` passes over an entity whose row the program cannot compute, and lets a statement that
  fails end the whole call. Under bug 102 a statement fails for the program's data. So a deploy whose index gives a
  long text for one entity's state makes every `reindex` die at that entity, with an `SqlError` that names no entity,
  and the entities after it keep the rows of the version before. The test is `reindex passes over an entity whose new
  index PostgreSQL cannot hold, alike on both dialects`, in `src/storage.test.ts`. A bound in `shownOf`, the first fix
  of bug 102, would list the entity in `failed` with no change of `reindex`.
- **105. On PostgreSQL, a step whose index cannot be written is tried again for ever, and its entity is neither
  stepped nor suspended.** A transaction that fails in the database is tried again after the retry, on the premise
  that the database's failure passes. Under bug 102 it never passes. So a completion whose state gives a long index
  stays first in the mailbox, the entity's state never moves past it, its other work waits, and `suspended` names
  nothing. A warning is logged at each retry. The operation ran once. The test is `a completion whose step writes a
  long index is stepped or suspends its entity, alike on both dialects`, in `src/runtime.test.ts`. A bound in
  `shownOf` makes the case a defect that suspends the entity, as an index that is no scalar is.
- **110. No job runs on a server of PostgreSQL the cases past the sample of `bun test`.** A sampled test runs a few
  cases under `bun test` and every case under `SCHEDULES=all`: the property of the fixtures, the dialects' property,
  the names of the tables, and the histories. The job `postgres` of `ci.yml` runs `test:postgres` with no
  `SCHEDULES`, and the job `release` runs every case with no server. So every case runs on PGlite alone, which runs
  one session and hides what a pool does. The test is `a job runs on a server of PostgreSQL every case of the files of
  test:postgres, as the release runs them on PGlite`, in `src/form.test.ts`. The fix runs `test:postgres` under
  `SCHEDULES=all` in a job with the server, or gives the job `release` the service of PostgreSQL and `POSTGRES_URL`.
- **114. The waker never reads again an entity whose time `due` refuses.** The doc comment of `Due.refused`, in
  `src/storage/entities.ts`, says the waker tries each refused entity again after `retry`. `waking` of
  `src/runtime.ts` reads `ready` and `next` alone, and sleeps until `next`, or for ever where `next` is null. So an
  operator who mends a refused row by hand waits for another timer or a step before the timer fires. Only SQLite
  holds such a row, since a column of PostgreSQL refuses a time that is no integer. The test is `the waker reads
  again after the retry an entity whose time it refused`, in `src/runtime.test.ts`. The fix is one of two: the waker
  reads again after `retry` while a row is refused, and logs it, or the promise and the field `refused` go.
- **115. The storage reads an entity's keys in no order, so two of its timers due at one time fire in an order
  `nextTimer` does not say.** The doc comment of `nextTimer`, in `src/machine.ts`, says that of two timers due at one
  time the first in the stored work fires first, and that a restart keeps the order. `entity` of
  `src/storage/entities.ts` reads the rows of `effecttea_entity_keys` with no `ORDER BY`. SQLite gives them by their
  primary key, and PostgreSQL in any order. So a program whose two timers fall due together handles their messages in
  an order that a dialect may change. The test is `fires two timers due at one time in the order of the stored work`,
  in `src/rehearse.test.ts`, where `a` fires before `b` though `b` was armed first. The fix is one of two: the
  storage keeps the order of the work, or `docs/design.md` promises no order of one entity's timers due together,
  and `nextTimer` says so.
