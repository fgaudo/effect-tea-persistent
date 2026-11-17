# Roadmap

The steps from this design to a library, in order. Each one may change the ones after it. When a step is done,
it leaves this file, and what it decided goes into the design, a decision or an example.

## Next

- **The rules move from the notes into documents kept true.** Every rule a note outside the archive decides is said
  in `docs/design.md`, the README or `AGENTS.md`, every premise the code rests on today is a bullet of
  `docs/premises.md`, and every alternative a later proposal could bring again is an entry of `docs/rejected.md`.
  The notes then lie in [`archive/`](decisions/archive) as records of why. A reading of every pair of notes costs
  more than it finds once the notes number in the hundreds, so this step replaces what was left of the premise
  review. Its note is
  [decision 0294](decisions/0294-the-rules-move-from-the-notes-into-documents-kept-true.md), `proposed`, rewritten in
  place while the step is under way. The maintainer chose the step on 2026-11-17, and that it runs beside the step
  The tests of a contract on every backend, below, which changes `src/` and its own note.
  - The areas are the twelve shared states that the premise review was to read last, and five areas for the notes of
    no shared state. Each of the 96 notes outside the archive and of no step under way is listed in exactly one area,
    by the state its rule keeps, and a note of no state by what it decides. The notes `proposed` of the steps under
    way, decisions 0283, 0292, 0293 and 0294, are listed in no area. A note taken while this step runs joins the area
    of its state.
    1. The tables of Cluster's requests: `effecttea_sent_requests`, `effecttea_given_requests`, `cluster_messages`
       and `cluster_replies`. Notes 0248, 0249, 0290 and 0291.
    2. The tables of replies: `effecttea_replies`, `effecttea_answers` and `effecttea_waiting`. Notes 0245, 0253,
       0265, 0269, 0282, 0285 and 0289.
    3. The tables of an entity: `effecttea_entities`, `effecttea_entity_keys` and `effecttea_mailbox`. Notes 0185,
       0205 and 0260.
    4. The tables of versions: `effecttea_versions` and `effecttea_runner_versions`. Note 0247.
    5. The tables of projections and of the log: `effecttea_projections`, `effecttea_log` and `effecttea_heads`.
       Notes 0207, 0209, 0277, 0284 and 0287.
    6. The table `effecttea_publications`. Note 0286.
    7. The tables of the outbox: `effecttea_outbox`, `effecttea_consumers` and `effecttea_cursors`. Notes 0184, 0224
       and 0288.
    8. The locks of the process, `locks` of `src/runtime/process.ts`. Notes 0246 and 0274.
    9. A deployment's entities and shards: `loaded`, `shards` and `waker`, of `src/runtime.ts` and
       `src/runtime/waker.ts`. Notes 0252, 0258, 0259 and 0273.
    10. A loaded entity's state, of `src/runtime/loop.ts`: its queue of events, `operations`, `timers`, `callers`
        and `links`. Notes 0194, 0220, 0221, 0243 and 0271.
    11. The process's maps of callers and deploys: `messages`, `creations`, `operators`, `undeployed`,
        `resumptions` and `recent`. Notes 0219, 0261 and 0280.
    12. The readings of commits: `commits` and `waiting` of `src/runtime/readings.ts`. Notes 0256 and 0275.
    13. The machine and the program, of `src/machine.ts` and `src/program.ts`, with what a boundary does with an
        answer. Notes 0179, 0180, 0181, 0182, 0183, 0188, 0190, 0192, 0197, 0199, 0201, 0202, 0204, 0240, 0266,
        0270 and 0272.
    14. The rehearsal and the testing module, of `src/rehearse.ts` and `src/testing.ts`. Notes 0186, 0187, 0189,
        0200, 0211, 0244, 0262 and 0281.
    15. The schemas a program declares, and what is read back of their JSON. Notes 0206, 0210, 0213, 0214 and 0276.
    16. The project: its entries, its package, its checks and its CI. Notes 0193, 0195, 0196, 0203, 0212, 0241,
        0242, 0250 and 0254.
    17. The launch, the hold of a database and the tables' migrations, of `src/storage/tables.ts` and `launch` of
        `src/runtime.ts`. Notes 0191, 0198, 0208, 0215, 0216, 0217, 0218, 0222, 0223, 0225, 0251, 0255, 0263, 0264,
        0267, 0278 and 0279.
  - Each area also reads the archived notes that the code of its state cites, for the premises that still hold. Its
    session lists them as it starts, since the code changes while the step runs. Of areas 1 to 7,
    `bun scripts/premise-pairs.ts --tables` gives each table's declarations and notes. Of the other areas, the notes
    are those the declarations of the state or of the module cite. An area whose notes to read whole are more than
    thirty is divided before its session starts.
  - Next, area 4, then the areas in the order of the list. Area 4 holds one note, so its session sets the form of
    `docs/premises.md` and `docs/rejected.md` on a small area.
  - Then the areas, one at a time, each moved in one commit. A session reads the area's notes whole, the archived
    notes its code cites and the declarations of its state that cite no note, with the code, by the section A reading
    of one shared state of [`.claude/skills/premise-review/SKILL.md`](../.claude/skills/premise-review/SKILL.md). It
    writes the area's rules into the documents, its premises into `docs/premises.md` and its alternatives into
    `docs/rejected.md`, and moves its notes to `archive/`, with the index. A finding is a bug of
    [`docs/bugs.md`](bugs.md), or an [open question](open-questions.md) where no test reproduces it yet. The first
    area moved makes `docs/premises.md` and `docs/rejected.md`, and the test of `src/form.test.ts` that every premise
    of `docs/premises.md` states its state in bold and that each test it names exists. A session that moves an area
    writes `Done, ` before it here, with what it found and what it did not reach. Of areas 13 to 17, which hold no
    shared state, the state of that section's brief is the module or the section the area names. A subagent may
    draft an area, and the session checks the draft against the code before it commits. Two sessions do not move
    areas at once, since every area writes `docs/design.md`, `docs/premises.md` and the index.
  - The last part changes the rules of work, as decision 0294 says: the section on notes of
    [`AGENTS.md`](../AGENTS.md), the records of `docs/records/` for a design weighed for a step, the citations of a
    comment, the consent of the maintainer to a new premise, the checks of `src/form.test.ts` on the notes, the skill
    of the review written again for `docs/premises.md`, `scripts/premise-pairs.ts`, and how `docs/bugs.md` says a
    fix is made. It also says how the steps below that name notes read then: The tests pruned by the mutations, A
    test of invariants over generated histories, and The release.
  - The step leaves this file when every note but those of steps under way lies in `archive/`, and the last part is
    done. Decision 0294 is taken by that commit, and is a record from then on.

- **The tests of a contract on every backend.** It is the fourth kind of test of `AGENTS.md`, and the rule of
  families C and D of [`docs/bugs.md`](bugs.md). One set of requests runs alike on each way the library runs, and the
  answers, the projections and what an operator reads must be the same on each. The ways are SQLite and PostgreSQL
  on one process, PostgreSQL with a pool on the CI's server, and Cluster with two runners on one file. Its note is
  [decision 0283](decisions/0283-a-contract-runs-one-set-of-calls-on-every-backend.md), `proposed`, rewritten in place
  while the step is under way and taken by the commit that takes the step out of this file. The rule of family D is
  [decision 0284](decisions/0284-a-statement-reads-its-condition-from-a-row-it-has-locked.md), accepted. The maintainer
  chose on 2026-11-12 to run this step beside the second reading of the premise review, and on 2026-11-13 to take it
  before the two steps on deploys below and the step of the process's pure core. Bugs 2, 3, 10, 11 and 12 are cases
  of it.
  - Done, on 2026-11-12: [`src/contract.test.ts`](../src/contract.test.ts), renamed from `src/dialects.test.ts`. Its
    property `every backend answers every call alike` runs the calls fast-check generates on SQLite, on PostgreSQL and
    on Cluster with two runners, which start once in a `beforeAll` and which the runs share. Each run prefixes its ids
    and request ids, and every reading names the run by the index `run`. Cluster's answer to a creation the program
    dies on, which decision 0160 decided, was marked once there, by `diesOn` and `pastWaits`, until decision 0291
    made every backend answer it alike. It passed 300 runs under
    `SCHEDULES=all`.
  - Done, on 2026-11-12, the pool, for family D: the test `two calls held at a statement on a pool answer as one
    order of them`, in the same file. A history makes the entities `a` and `b`, sends a few messages one at a time,
    then runs two calls at once through `onPool`: a message `Add`, a creation, `expire`, `reindex` or `prune`. A
    connection of its own holds `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE` on one table of the library, drawn by
    `gate`, and lets it go once both calls wait or after a second. The answers and the readings after must equal one
    of the two orders on SQLite, by `serially`. A case pinned is an example of `onPool`, whose `gate` names its table.
    It runs a hundred runs, only where `POSTGRES_URL` names a server. It reproduced bug 25, which decision 0284 fixes.
  - How a test of a server runs. The maintainer's machine has no server of PostgreSQL: no Docker, and WSL does not
    start. So a session pushes its work and reads the job `postgres` of the CI, which runs `bun run test:postgres`
    against PostgreSQL 17 on every push. `gh run list --branch <branch> --limit 1` gives the run, and
    `gh run view --job <id> --log` its log, where the test prints `two calls held at once in N of M runs`. A test that
    should fail before a fix is pushed first on a branch of its own, `claude/<name>`, without the fix, so that `main`
    stays green. The fix is then committed on that branch and pushed, and the branch is fast-forwarded into `main` once
    its CI passes. A note written on such a branch takes the next free number of `main` when it is merged.
  - Done, on 2026-11-12, bug 13, `expire`: [decision 0285](decisions/0285-a-batch-of-expire-skips-the-replies-a-step-holds.md).
    Its case in the test of the pool is `bug13`. Its `gate` locks the row of one reply, and not a table, since a
    message's step reads its reply before its transaction, and a table locked would stop the step there.
  - Done, on 2026-11-12, bug 80, the trigger of the publications:
    [decision 0286](decisions/0286-the-trigger-of-the-outbox-locks-the-publications-in-order.md). No pair of the pool
    reaches it, so a scenario of `src/postgres.test.ts` holds it, as the note says.
  - Done, on 2026-11-12, bug 78, the reading of the log: [decision 0287](decisions/0287-a-reading-of-the-log-gives-each-partition-up-to-its-first-head.md).
  - Done, on 2026-11-12, bug 111, a deadlock of two prunes at once that the pool found:
    [decision 0288](decisions/0288-a-batch-of-prune-skips-the-rows-another-batch-holds.md).
  - Done, the other cases of the rule of decision 0284, one at a time, since each changes `src/storage/` and pins its
    case in `src/contract.test.ts`. Each is a note of its own that cites decision 0284 and adds itself to that note's
    status line. Its case is pinned in the test of the pool, and fails on the CI before the fix. The opinion of a
    Fable 5.2 agent of 2026-11-12, behind decision 0284, proposed each fix below, and each is reasoned until its test
    passes on the server.
    1. Done, on 2026-11-12, bug 49, a deadlock of the sweep's batch and a step's deletion of its entity's replies,
       fixed by decision 0285 with no note of its own. Its case `bug49` passes on the pool, and deadlocked against a
       batch that waits for a reply's row. `forgetUnder` of [`src/storage/cluster.ts`](../src/storage/cluster.ts),
       which runs only on Cluster, stays an open question.
    2. Done, on 2026-11-12, bug 3, a reply to another entity's operation that stays for ever, fixed by
       [decision 0289](decisions/0289-expire-deletes-what-work-that-ended-was-given.md): `expire` deletes the replies
       and the answers kept for work that has ended. The maintainer chose the sweep over a lock of the asker's key.
  - Done, on 2026-11-12, the pool's gate. The test runs each history on SQLite first, records the tables each call of
    the pair writes, and draws the gate among those both write, as decision 0283 says. Both calls waited at the lock
    in 40 of a hundred runs on the CI's server, where a gate drawn among every table held 6 and 13.
  - Done, on 2026-11-12, an operator's calls in the contract, on every backend: `inspect`, `resume`, `discard`,
    `expire`, `prune` and `reindex` beside `suspended`, and a `Boom` followed by an operator's call on its entity. The
    first run of 300 found a race of the test, which decision 0283 says, and none of the backends. Two runs of 300
    passed after it.
  - Done, on 2026-11-12, an operation that sends to another entity and a timer in the contract, on every backend: a
    message `Forward` of the program `item`, which sends `Add`, and a message `Tick`, whose timer is due at once. The
    runs of 300 found three races of the test, which decision 0283 says, and none of the backends. Three runs of 300
    passed after them.
  - Done, on 2026-11-13, bug 11, the rows of an operator's resume or discard that Cluster kept for ever: reproduced
    by a test of `src/cluster.test.ts`, and fixed by
    [decision 0290](decisions/0290-on-cluster-an-operators-client-keeps-the-id-the-doors-answer-carries.md).
  - Done, on 2026-11-13, bugs 10 and 58, a creation the program dies on that Cluster delivered again without end:
    reproduced by tests of `src/cluster.test.ts`, and fixed by
    [decision 0291](decisions/0291-on-cluster-a-creation-the-program-dies-on-is-answered-died-and-reset.md), which the maintainer chose after an opinion of a Fable 5.2 agent,
    each of its premises tested. The test of a contract no longer marks such a creation by `diesOn`.
  - Done, on 2026-11-13, an operation's creation in the contract, on every backend: a message `Spawn` of the program
    `item`, whose operation creates another item, and a `Spawn` whose label is text no database holds, which the
    program dies on, followed by an operator's call on the item that spawns. A run of 300 passed, and found none of
    the backends otherwise.
  - Done, on 2026-11-13, the pool reaches bug 80: its histories hold an ack of a consumer and a prune, and a call
    of the pair may ack and then prune, so that two prunes see the log otherwise. No deploy was needed, since the
    consumers are declared at the first deploy. Its examples `bug80` fail on the CI against the trigger before
    decision 0286.
    A difference of Cluster that a note decides is marked in the test of a contract, as decision 0283 says, and a
    difference no note decides is a bug.
  - Under way, the tests of the runtime that hold a rule of one process, which `src/runtime.test.ts` holds, run on
    Cluster too where the rule is said to hold there, so that a rule of one process that holds otherwise on Cluster
    fails a test. Decision 0283 says how: `everywhere` of
    [`src/runtime.test_backends.ts`](../src/runtime.test_backends.ts), and the group `a rule of one process that holds
    on Cluster too` at the end of `src/runtime.test.ts`.
    - Done, on 2026-11-13, five rules, none of which needs a test clock or a probe: a retry and `NotFound`, a reason
      of `-0`, a suspension and its discard, two callers under one request id with two messages, and two callers of
      one request under a keep of 0. They passed on every backend, and found no difference.
    - Done, on 2026-11-13, the `describe` `the runtime on SQLite`, read whole. Six rules moved, each needing neither a
      test clock nor a probe: a request or a reading left out, a keep that is no keep, an id and a request id that no
      database holds, a cause that holds U+0000, and an index that is no scalar. They passed five runs in a row on
      every backend. One difference was found, and decision 0248 decides it: on Cluster a retry under a `keep` of 0 is
      answered from Cluster's rows and not applied again, which the rule marks. Every other test of the `describe`
      moves the test clock, by `ran`, `running` or `TestClock`, or holds a step at `BeforeCommit` by a probe, but
      four. `warns of a step past its threshold once per activation` counts the warnings of one logger, while each
      runner logs on its own. `an option or a field of it given null is the launcher’s defect` launches a process,
      and `everywhere` launches its runners once. `a request leaves out its sender and flags only where the program
      has none` runs nothing, as the compiler holds it. `an entity whose messages keep coming lets another step
      between two of its steps` is a rule of one loop, and a caller's message on Cluster is stepped by its door.
    - Done, on 2026-11-13, the `describe` `the read model`, read whole. One rule runs on both as a rule of its own:
      the part of `a query finds the entities by an index, in order, and gives what callers read` that needs no
      second process, on a program `Counting` whose projection counts the messages applied, so that no operation's
      end changes it. It passed five runs in a row on every backend, and found no difference. Every other test of the
      `describe` deploys a second version of the program, reads SQLite's plan, or runs under the scheduler.
    - Under way, the `describe` `publishing what happened`. `everywhere` registers a program with the consumers its
      deploy declares, as `[program, queue]`, and a rule deploys it with the same, which `everywhere` checks. Each
      rule of the log has a program of its own, made by `holding` in the group, whose operations never come back and
      whose timer rings in an hour, since the rules on Cluster share a program's log and its prune.
      - Done, on 2026-11-13, seven tests moved whole, each needing neither a second process nor the clock: a row
        published by each step that changes what callers read, a seq never given again, a topic no consumer holds
        pruned whole, an ack past the last seq, a cursor or a limit out of range, a consumer of every partition, and
        a cursor of one program. Each lists a consumer behind `since` a time the real clock gives, which the rule
        does not pin. They passed five runs in a row on every backend, and found no difference.
      - Done, on 2026-11-13, four tests moved whole. Three moved the test clock only so that the toy's work ends,
        and a rule waits on the real clock for the rows in its place, by `publishedOnce`: a cursor read after its
        rows and a prune, a consumer declared at deploy, and entities stepping at once. The fourth is two readers of
        one consumer. They passed five runs in a row on every backend. One difference was found, and decision 0162
        decides it: on Cluster the log has as many partitions as a group has shards, twelve under `everywhere`, and
        the rule marks it. `the entities of one partition share its sequence, in the order their steps committed`
        stays a test of one process, since it launches with `log: { partitions: 1 }` and `everywhere` launches its
        runners with the default.
      - Next, the rest of the `describe`, read whole: the tests of `consume`, of a transaction and of a wait. A
        reading of their names gives a lead only. The tests of `consume` and of a transaction run within a
        transaction of the test's own client, which a runner of Cluster may not share, and the tests of a wait hold
        the clock still.
    - Next, the other tests of `src/runtime.test.ts` that the design says hold on Cluster, read one `describe` at a
      time, after `publishing what happened`: `a planned stop`, `a schema that changes`, `what the runtime cannot
      finish`, `a database held by one runtime`, `renaming a program (decision 0156)` and `a launch that dies holds
      nothing in the scope its launcher gave (decision 0264)`. Most hold an
      interleaving by a probe or the test clock. A rule moves whole where its test needs neither, or moves the clock
      only so that the toy's work ends, as decision 0283 says, and else its part
      that needs neither runs on both as a rule of its own. A rule that needs a deploy of a second program needs a
      runner that `everywhere` does not start yet. A difference found is a bug of `docs/bugs.md`, or a case decision
      0283 marks where a note decides it.
    - Read on 2026-11-13 and left as tests of one process: `two operators who discard at once are each told what
      their own discard did`, which holds the first discard before its commit by a probe; `an operator inspects an
      entity: its state, its mailbox, its work and its suspension, as stored`, which needs hands that never come
      back, `hands({ holds: true })`, while `everywhere` deploys the toy with hands that do; and `a query finds the
      entities by an index, in order, and gives what callers read`, which runs two processes one after the other.
    - Done, on 2026-11-13, whether a runner of Cluster reads the `Probe`: it does, as decision 0283 says, but a rule
      that holds a step by a probe still stays a test of one process. A door's step says only `BeforeCommit`, inside
      Cluster's transaction, and a hold there stops both runners on their one file of SQLite. So `everywhere` takes
      no hooks, and every test of `the runtime on SQLite` that holds a step at `BeforeCommit` stays where it is, the
      two discards at once among them. Such a rule runs on Cluster once the runners are on a server, in the step The
      runtime on Cluster across machines, on PostgreSQL, below.
  - The step leaves this file when the parts above are done, and decision 0283 is taken, `accepted`, by that commit.

- **A door that changes between two releases of the library, to verify and fix.** A release of the library that adds
  an RPC to the door of a program on Cluster, or changes a payload, is not caught by the guard of the version
  ([decision 0159](decisions/archive/0159-on-cluster-an-older-version-serves-no-shard-once-a-newer-one-launches.md)).
  A runner of the older release that still holds a shard is given the newer request, and Cluster answers a payload
  it cannot decode with a defect and stores it, so the request is lost in silence. The spike
  [`spikes/cluster-older-runner-answers-a-newer-request.test.ts`](../spikes/cluster-older-runner-answers-a-newer-request.test.ts)
  sees Cluster's answer. No test runs a rolling deploy of two releases of the library. It begins with a test of `src/cluster.test.ts` with two runners whose doors differ, and its fix
  is a choice of the design, which the [open question](open-questions.md#running) A door that changes between two
  releases of the library lists.

- **What a deploy may change of a program, against what is stored.** This step is the rule of family A of
  [`docs/bugs.md`](bugs.md). Four of the bugs the premise review found have
  one form: a deploy of a newer version changes a piece of the program, while what is stored was written by the
  older version. They are the delivery of an operation (bug 1), the way the sender is written (bug 5), a droppable
  operation a resume drops (bug 7), and the door (the step above). The review reads one pair of notes at a time, so
  it finds such a case only where one pair holds it. This step lists every piece a program declares: the sender,
  the flags, the keys and their parameters, each operation and its delivery, the timers, the internal messages, the
  rejections, the projection, the children and the door. For each piece and each way a deploy changes it, it asks
  what happens to an entity stored, loaded, suspended or draining, on one process and on Cluster, with a deploy of
  a newer version and of an older one. Each case gets a test that shows it holds, or a sentence that says why it
  holds and cites the note that decides it. A case that fails is a bug of this step, fixed by a note with its test,
  as the bugs of `docs/bugs.md` are. The cases the steps above already hold cite them. A `reindex` an operator runs on the older runner of a rolling deploy writes the older
  projection over the row the newer runner wrote, since the entity's state and version did not change, which is bug
  77 of `docs/bugs.md`, reproduced. The table is written in `docs/`, so that a
  piece a later note adds to a program adds its row. The code that keeps the table is one place, where an
  activation by a program compares each piece stored with the program: the same, changed in a way the table
  allows, which it converts, or changed otherwise, which suspends the entity with a defect that names the piece.

- **Two entities' timers due at one time, in no order.** The design promises no order of two entities' timers due at
  one time, and a rehearsal fires them in the order of creation, which changes nothing a pure program shows. One
  entity's timers due at one time fire in the order of its stored work, which the runtime keeps where an entity's
  loop takes a `Fire`. A suspension closes a rehearsal's world, so that a scenario that catches a defect reads
  nothing an order decided. Its note is
  [decision 0293](decisions/0293-two-entities-timers-due-at-one-time-fire-in-no-order.md), `proposed`, whose rules the
  maintainer chose. Its first part is done: `nextTimer` of `src/machine.ts` chooses an entity's next timer, and
  `firing` of [`src/runtime/loop.ts`](../src/runtime/loop.ts) and `dueBy` of [`src/rehearse.ts`](../src/rehearse.ts)
  call it, with the tests the note names in `src/machine.test.ts` and `src/runtime/loop.test.ts`. The next part
  begins in `apply`, `run` and `restart` of `src/rehearse.ts`, where a runner's death applies `Die` and a suspension
  closes the world, with the tests the note says `open` in `src/rehearse.test.ts`. Then `docs/design.md` and
  `docs/glossary.md` say the rules, and the tests `two timers due at one time` assert that neither order is promised. Since it changes the runtime, it
  passes `bun run test:pins` and `bun run test:release` before it is taken. It touches no file of the step The tests
  of a contract on every backend, so it may run beside it. The step leaves this file when its tests pass,
  `docs/design.md` and `docs/glossary.md` say it, and decision 0293 is taken, `accepted`, by that commit.

- **The process's state as a pure core, and the tests of an order.** The fields of `Process`, `Deployment` and
  `Loaded` that another fiber reads move into a module that imports no `Effect`, as `src/machine.ts` is for an entity.
  The semantics of the process moves there too, and the rehearsal runs it as the runtime does.
  A transition takes a state and an event and gives a state and the commands to perform, and the shell performs it in
  one synchronous step. A rule of order of the process is then tested by fast-check over the orders of the core's
  events, with no model of Effect's scheduler. An order at a boundary is tested by a gate on the probe or on a service,
  and a rule that is a primitive's contract is kept by that primitive. The scheduler of `src/testing.ts` becomes a tool
  of search, and its pins go one at a time. Its note is
  [decision 0292](decisions/0292-the-processs-state-is-a-pure-core-and-a-test-holds-an-order-by-its-events.md),
  `proposed`. Nothing of it is written yet. It comes before the layer on the runtime of the step A test of invariants
  over generated histories, below, since the core changes how that layer is written.
  - The first part is the core of the state of [`src/runtime/callers.ts`](../src/runtime/callers.ts) and of the locks
    of [`src/runtime/process.ts`](../src/runtime/process.ts): the senders waiting for a resumption, the callers by
    entity and request, and the locks with their users. Its test generates the orders of the events and checks the
    rules as invariants. Its cases are the two interleavings of
    [decision 0104](decisions/archive/0104-the-runtimes-tests-choose-where-fibers-yield.md), each of which fails with
    its rule taken out of the core. Before any code, the part lists each of the eighteen pins of
    [`src/runtime.test_pins.ts`](../src/runtime.test_pins.ts) by why it needs a schedule, in decision 0292, which names
    the four reasons and the nine pins a first reading listed. It also runs a test with no schedule against the
    mutation of the waker's look for a poke, to check that no such test kills a mutation of form. The part names the module, adds it to the modules of the runtime in
    [`AGENTS.md`](../AGENTS.md) and to the diagram of [`CONTRIBUTING.md`](../CONTRIBUTING.md), and counts the seeds
    `bun run test:pins` loses to it. The part also decides the move of `holding` to `RcMap`, of the later step Code
    written by hand where a module of Effect does the same, since the core then counts the users of a lock.
  - The second part is the rest of the state: the counts `settled` and `drained` read, `draining`, the entities
    stopping, the shards held and the order of use. Its cases are decision 0109, the form of decision 0274 that
    `settled` reads, and bug 101 of [`docs/bugs.md`](bugs.md), which the part fixes by one of the three fixes the bug
    names. It decides the
    [open question](open-questions.md#running) A count of the process kept by an observer of a fiber's exit.
  - The third part is the semantics of the process that the rehearsal shares: which program steps an entity, a
    deploy and a restart, the replies kept across a restart and the ids refused. [`src/rehearse.ts`](../src/rehearse.ts)
    and the runtime then run one copy of it, as both run `src/machine.ts`, and `src/rehearse.test.ts` and
    `src/rehearse.property.test.ts` pass as they are. Its cases are the bugs of a rehearsal that answers otherwise
    than the runtime still open then, as bugs 5, 107 and 108 of [`docs/bugs.md`](bugs.md) are today. The code of
    the table of the step What a deploy may change of a program, above, moves into it. The part also moves into it
    what a transition keeps and deletes, now `keep` of `src/rehearse.ts` and the statements of
    `src/storage/entities.ts`, and how the outputs of a step are read, now in `src/rehearse.ts`,
    `src/runtime/loop.ts` and `src/runtime/doors.ts`.
  - The fourth part is how a request is answered, alike on one process and on Cluster. One function of what is
    stored and of a request gives the answer and the rows, and the callers of one process and the door of Cluster
    run it. Its cases are the bugs of family C of `docs/bugs.md` that the step The tests of a contract on every
    backend, above, leaves as differences of the answer. A difference of Cluster's tables, its poll or its lease stays
    outside the core.
  - The fifth part is the policies of the runtime: the entity unloaded past the capacity, `admit` of
    `src/runtime/loop.ts`, and the round of the waker, `waking` of `src/runtime/waker.ts`. Each is tested by
    fast-check with no scheduler.
  - The sixth part is the scheduler. A resumption becomes a choice of the strategy, and `Resumptions` goes from
    `src/testing.ts`. `bun run test:explore` runs in a job of the CI on a schedule. A pin of
    `src/runtime.test_pins.ts` goes once a case of the core, a gate or a primitive's test kills its mutation. A
    mutation of form is first written again as a check taken out, as decision 0292 says.
  - The step leaves this file when the parts above are done, and decision 0292 is taken, `accepted`, by that commit.
    The same commit changes the rules of `AGENTS.md` on two fields written in one step, on pinned seeds and on
    `bun run test:pins`.

- **A test of invariants over generated histories.** It is the second kind of test of `AGENTS.md`, which the library
  does not have yet. fast-check generates histories of commands: a message under a new request id or a retried one,
  an operation that completes or fails, time that passes, a crash and a restart, a deploy of a variant of the
  program, a resume and a discard. The variants of a deploy change one piece of a program at a time, as the table
  of the step What a deploy may change of a program lists them. A program of the test holds an operation of each delivery, a timer and a child, and
  records outside the machine each operation that starts. After each history the test checks the promises of the
  design as invariants. A message under a request id is applied at most once, and a retry is given the same reply.
  An at-least-once operation that talks only to entities acts once. An at-most-once operation is given `unknown`
  only where it started. No operation counts as running that never started. After a deploy an entity is active
  under the new program, or suspended with a defect. Every request is answered within a number of steps of the
  scheduler, so that a wait for ever fails the test. The histories run in two layers.
  - On the rehearsal, many and quick, for the logic of the machine, of a deploy and of a crash.
  - On the runtime under the scheduler of `src/testing.ts`, fewer, with commands at once: two callers, a completion
    while an entity unloads, a crash during a step, a sweep while a caller waits. Its strategies are those of the
    tests of concurrency, `prioritized` and `explore`, which stay.
  [`src/rehearse.property.test.ts`](../src/rehearse.property.test.ts), which compares the rehearsal and the runtime
  over generated messages, is where it begins. A failing history is shrunk by fast-check, and its shortest form is
  pinned as a case. On Cluster and on PostgreSQL with a pool, the invariants run through the step The tests of a
  contract on every backend, above.
  - It starts once two steps above are done: The tests of a contract on every backend, whose backends the invariants
    run on, and What a deploy may change of a program, whose table gives the variants of a deploy. Nothing of it is
    written yet. Its first part needs neither: the layer on the rehearsal, with histories without deploys, in a file
    of its own beside `src/rehearse.property.test.ts`, and the invariants that need no deploy.
  - The pieces it reuses are written: the prefix of a run and the shared runners of `src/contract.test.ts`, `onPool`
    for two commands at once on a pool, and the scheduler of `src/testing.ts` with its strategies. Its note is a
    `proposed` note of its own, made with its first part.
  - Its layer on the runtime waits for the step The process's state as a pure core, and the tests of an order, above.
    An invariant of a process's state is then tested on the core, with no scheduler, and the layer on the runtime
    checks what the core does not hold: the database, the forks and the time.

- **The tests pruned by the mutations.** Once the test of invariants exists, `scripts/mutate.ts` takes out each
  rule the notes decide, one at a time. A test of a scenario that fails only where a test of the four kinds of
  `AGENTS.md` fails too, under every mutation, goes, and its rule is said by the test that stays. A test that alone
  fails under a mutation stays. The step keeps the suite within its budget as the tests of the bugs come in.

## Later

- **The release**, once there is code to publish. It is released as experimental while it depends
  on Effect's unstable modules ([decision 0099](decisions/archive/0099-a-library-on-unstable-modules-is-released-as-experimental.md)).
  The release archives the notes the design has come to cover since the last archiving, as
  [`AGENTS.md`](../AGENTS.md) says. It passes `bun run test:release`, which runs every seed of the explored tests.
  The release decides whether `exports` names the sources or JavaScript with declarations, as effect-tea ships, and
  writes the metadata of `package.json`: a `description` in the words of the README, `repository`, `homepage` to the
  site, `sideEffects`, and `keywords` with the words people search this problem by, `saga` and `durable-execution`
  among them, since the README says where the library differs. What it publishes leaves out the files of the tests,
  `*.test.ts` and `*.test_*.ts` ([decision 0241](decisions/0241-a-group-of-modules-lies-in-a-folder-entered-by-the-module-of-its-name.md)).
  The release also weighs what effect-tea does at its own, as a reading of 2026-11-17 found:
  - a `CHANGELOG.md` with an entry for each change a user can notice, and a skill of the release that says how a
    version is chosen before 1.0 and when the site deploys, from a tag rather than from `main`;
  - a report of the public API, written by API Extractor from the declarations and committed, which the CI checks;
  - the conditions `bun`, `types` and `default` of `exports`, a build of `dist/`, and a test that packs the package,
    installs it with npm, and runs and typechecks it as a user outside Bun gets it;
  - a skill shipped in the package that leads a user's coding agent to the guide and the examples of the version
    installed;
  - a tutorial on the site, built step by step from regions of the examples;
  - a benchmark of the runtime, as the steps and the transactions a second, run in the CI.

- **The runtime on Cluster across machines, on PostgreSQL**, once Cluster has a fence
  ([Effect-TS/effect#10058](https://github.com/Effect-TS/effect/issues/10058)), or the runtime one of its own. Until
  then a step commits only where the commit checks the shard, which on Cluster is SQLite
  ([decision 0084](decisions/archive/0084-a-step-commits-only-where-the-commit-checks-the-shard.md)). A fence of the runtime's
  own is tested on the server of PostgreSQL with a pool that the CI runs
  ([decision 0222](decisions/0222-postgresql-with-many-connections.md)). The step also decides whether the runtime
  checks its advisory lock, which a server that ends its session gives back
  ([open question](open-questions.md#running)). Its runners on a server run on Cluster too the rules of one process that
  hold a step by a probe, which a file of SQLite shared by two runners cannot hold
  ([decision 0283](decisions/0283-a-contract-runs-one-set-of-calls-on-every-backend.md)).

- **An act of a rehearsal from several fibers**, postponed by the maintainer on 2026-11-13. Bug 112 of
  [`docs/bugs.md`](bugs.md) is a request id that two fibers of a scenario send at once, applied twice. Its test is a
  `test.failing` of `src/rehearse.test.ts`. The [open question](open-questions.md#programs) on a scenario of several
  fibers lists the other acts of the same form, none run, and the two fixes. The maintainer chose neither yet. The
  session that found the bug recommends that each act be one synchronous step:
  - a synchronous core of `apply` in `src/rehearse.ts` gives the outputs or the suspension, and `receive`,
    `complete`, `fireOf`, `born` and the two `create` call it in the thunk that reads;
  - `advance` becomes one step, since all it does is synchronous;
  - `run` stays in two steps, since the runner is an effect of the program, and the incarnation drops an answer that
    came late;
  - each act gets a test of two fibers under `Scheduler.MaxOpsBeforeYield` at 1, and the test of bug 112 becomes a
    `test`;
  - a note says what a rehearsal promises to a scenario of several fibers, and the guide says it in a sentence.

  The step begins at `receive` of `src/rehearse.ts`.

- **Code written by hand where a module of Effect does the same**, of low priority. A review of `src/` against
  the rule of [`AGENTS.md`](../AGENTS.md) on Effect's modules found four places, on 2026-11-11:
  - The lock of each entity, `holding` in `src/runtime/process.ts`, keeps a `Map` of a semaphore and a count of its
    users, and deletes the entry when the last user lets go. `RcMap`, which is stable, shares a resource by key and
    releases it when the last scope closes. The comment does not say what `RcMap` does not do. A seed of the
    test `callers of an unloaded entity build one machine for it` is pinned against a bug of this count. A move to
    `RcMap` adds and moves yields, so it finds the pinned seeds again, as `AGENTS.md` says, and passes
    `bun run test:release`.
  - The order of use of the entities, `recent` in `src/runtime/process.ts` and `admit` in `src/runtime/loop.ts`, is
    written by hand for a reason: `Cache` evicts by itself, and the runtime never unloads a busy entity or one whose
    timer is due. `RcMap` refuses a new key at its capacity rather than evicting. The comment says neither.
  - About fifteen guards are written as `typeof value === 'object' && value !== null`, with `!Array.isArray(value)`
    or `TypeId in value`, in `src/machine.ts`, `src/program.ts`, `src/runtime.ts`, `src/storage/held.ts` and
    `src/storage/projections.ts`. `Predicate.isObject` and `Predicate.hasProperty` are those guards.
  - The comparisons of keys, `(a < b ? -1 : a > b ? 1 : 0)` in `src/machine.ts` and `src/program.ts`, are
    `Order.String`, and the sort by incarnation in `src/runtime.ts` is `Order.mapInput(Order.Number, …)`.
