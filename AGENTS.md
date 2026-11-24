# effect-tea-persistent — guide for coding agents

This repository is a design and its pure core, not a library yet. Read [`README.md`](README.md), then
[`docs/design.md`](docs/design.md), with [`docs/glossary.md`](docs/glossary.md) at hand. What to do next is the first
step of [`docs/roadmap.md`](docs/roadmap.md). [`docs/review-2026-11.md`](docs/review-2026-11.md) says why the work
starts again from the pure core, and what the owner chose then. The review calls the owner the maintainer.

## Deciding

The owner leaves the decisions of the project to the agent that does the work, and keeps the two kinds listed below.
A decision is not put to the owner because it is hard, or because it breaks something. The agent takes it by the
values of this section, says it in one line in the report of its step and in the commit, and the owner may undo it.

### The values, in order

When two of them pull apart, the higher one wins. When the lower one would lose much, look first for a third design,
changing a rule of the design or the API if that is what it takes.

1. **Correct.** Every behaviour is defined, and nothing fails in silence.
2. **Misuse is impossible by construction.** Only a misuse that leaves the library's behaviour undefined needs a
   refusal: one that only exposes users to their own bugs is allowed. A refusal comes from the types or the shape of
   the API first; where they cannot give one, from a defect as the program enters (`deploy`, `rehearse`); last, from
   a rule that nothing checks, listed in `docs/design.md`, under "What is left to you". Two things are axioms, never
   checked: the functions of a program are pure, a state is never mutated.
3. **The public API is small, clear and symmetric.** Few concepts. One word for each concept, and one concept for each
   word: `docs/glossary.md` is the dictionary. A name says what the thing is to a user, the same role has the same
   form, and a thing is done one way. Users judge the library by its API first.
4. **The design is coherent and pure.** A concept is treated alike wherever it appears, and has a module of its own.
5. **The implementation is simple.** Fewer mechanisms, less code, fewer premises. A premise is a fact about a
   dependency that a rule rests on, held by a spike.
6. **It is fast enough.** A cost in memory or in time that grows with no need is a bug, and counts as 1. Anything else
   is optimized only once it is measured, and never at the cost of 3.
7. **It is cheap to keep.** Documents, tests, tools and procedures serve the values above. One that costs more than it
   protects is cut, and a rule added removes or merges another, or says why it cannot.

### What may change

Everything but this section may change when the change ranks higher by its values: a rule of `docs/design.md`, a rule
of this file or of a skill, a budget, a name or a shape of the API. Before 1.0 a breaking change is welcome where it
makes the API right.

### What the owner decides

- Whatever leaves this machine: a push of commits or tags, an issue, a pull request, a release or a comment, on
  GitHub or anywhere else, a message to anyone, and publishing to npm. Commits and tags stay local, and the owner
  pushes them.
- What the project is: its purpose and its users, a dependency or a peer added or removed, a new bridge to a system
  outside the library, as a database, its licence, and 1.0.

### How a decision is taken and kept

- A decision is written where the next agent looks: a line of the step's report, a line of its commit's body, and the
  sentence of `docs/design.md` it changes, with its reason beside it.
- A decision is not reopened without a new fact: a bug, a user's report, a change of Effect, or an argument the
  decision did not weigh. The commit that reopens it names the fact.
- A decision the owner undoes is written beside its rule in `docs/design.md`, with the owner's reason.
- What is the owner's is asked as one question, under "For the owner" of `docs/open-questions.md`. The question gives
  the agent's choice first, what each answer changes for a user of the library, and whether it can be undone. The
  step that waits for the answer says so in the roadmap, and the work goes on with the next step that does not wait.

## A run with no one to ask

The workflow [`.claude/workflows/roadmap.js`](.claude/workflows/roadmap.js) does the open steps of the roadmap in
their order, and asks no one. An agent does a step on the model and effort the step names. An agent that did not
write the step then reviews its commits against the step's "It is done when", the checks and the values, before the
next step begins. A finding is mended by a new commit and reviewed again. The run stops when a step is not done by
its third agent or fails its third review, or when every open step waits for the owner.

## The notes are frozen

The notes of `docs/decisions/`, `docs/premises.md` and `docs/rejected.md` are frozen: none is added, moved or
edited, and the notes still `proposed` stay so. A comment keeps its citation of a note until its code is written
again, and code written again cites no note. Step 9 of the roadmap deletes the notes.

## The rules of work

- **One specification, kept true.** `docs/design.md` says what holds. A commit that changes a behaviour changes its
  sentence in the same commit. Why a rule holds is a sentence beside the rule. There are no new notes.
- **A rule the code keeps has a test that fails without it.** A fact about a dependency that a rule rests on has a
  spike.
- **Removing comes first.** A change asks what it can take out before it asks what to add. An edge case is refused
  where it enters, before it is given a mechanism. One job has one mechanism.
- **Budgets.** The runtime and the storage, without tests, stay under 3,000 lines together. `AGENTS.md` stays under
  180 lines and `docs/roadmap.md` under 150. `docs/design.md` comes under 600 lines at step 9 of the roadmap, and
  stays there. A change that would cross a budget first takes something out. Where nothing can go, its commit raises
  the number, and says in a line what the lines buy.
- **No feature while more than ten bugs are open.**
- **What a session finds is a failing test, a bug of `docs/bugs.md`, a question of `docs/open-questions.md` or a
  step of the roadmap.** A finding is never left in a report or in the chat alone. A bug fixed leaves its file, and
  git keeps it.
- **A step under way can be continued by a session that knows nothing of the one before it.** Before a session stops
  inside a step, the step in the roadmap names the parts done and the part next, and what only the conversation held
  is written there: a premise found, a test still red, a choice the owner made in chat.

## Prose and commits

- All code, comments, identifiers, commit messages and `.md` files are in **English**.
- A commit made with an AI agent ends with an `Assisted-by: <model>` trailer, never `Co-Authored-By`.
- Work is committed on `main`, with no branch first, and stays local until the owner pushes it. A branch is only for
  a session that works beside another one.
- A commit message stays short: a subject line of at most 72 characters in the imperative, and a body only for what
  the diff cannot say and for the decisions of the step, a line each.
- A commit's subject starts with the module or area it changes, then a concrete action:
  `runtime: interrupt children when a run ends, without yielding`. The area is a module's path under `src/` without
  its extension, as `runtime/loop` for a module in a folder, or `docs`, `examples`, `spikes` or `scripts`. A commit
  across several modules of a group names the group, and a commit across several areas names the one it is about.
- Prose states its conclusion first, one sentence per idea, without chains of subordinate clauses. This holds for
  `.md` files, comments and commit bodies.
- Every document and comment is written for a person who reads it for the first time, and is understood on one
  reading. A pronoun, `one` or `its` names something in the same sentence. A sentence held together by a colon and a
  dash is two sentences. A noun left out for the reader to supply is written.
- A page of the guide is checked by a reader who has not seen the code, who builds a program for a requirement no
  example holds from the README and `docs/` alone. The reader is a subagent, and
  [`.claude/skills/guide-reader/SKILL.md`](.claude/skills/guide-reader/SKILL.md) is the procedure, with its brief.
- A comment stands where the code alone does not say why: a wait, a lock, a fork, an order of statements that
  matters, a guard against a case a reader would not think of. It says what the code keeps and why, in a sentence.
  A line a reader understands from its names gets none.

## Code and tests

- The examples import the library as a user does, by the package's name and its entries:
  `@fgaudo/effect-tea-persistent`, `@fgaudo/effect-tea-persistent/program` and
  `@fgaudo/effect-tea-persistent/testing`. The `exports` of `package.json` resolve each to its file of `src/`, so
  the examples run on the sources with no build. A module that declares a program imports from
  `@fgaudo/effect-tea-persistent/program`, the import a browser can load. When the design changes, the code, its
  tests and the examples change with it, and `bun run typecheck`, `bun test` and `bun run links` pass.
- The library's tests run on programs of [`src/fixtures/`](src/fixtures), copied from the examples once. They import
  no example, so that a change of an example breaks no test of the library, as a test of `src/form.test.ts` checks.
- A file that only tests import is named `<module>.test_<role>.ts`, beside the module whose tests it serves, as
  `src/runtime.test_shared.ts`. `bun test` runs no such file, and no module of the library imports one.
- Before code adds a helper, a data structure or a coordination of fibers, it looks in `node_modules/effect/src` for
  a module that does the same, `@stability unstable` ones too, and uses it. Code written by hand beside such a module
  says in a comment what the module does not do. An unstable module that `src/` does not import yet is a premise:
  the commit that first imports it adds the spike of what the code rests on in it.
- [`src/machine.ts`](src/machine.ts) is the runtime's semantics. A rule it adds or changes changes its sentence of
  `docs/design.md`, and [`src/machine.test.ts`](src/machine.test.ts) has a test that fails without it.
- A spike is a test in `spikes/`, run by `bun run test:spikes` and by a job of the CI, never by `bun test`. It
  checks what a rule rests on, never a detail of a version, so a move of Bun or Effect fails it only where that fell.
- A fact about Effect is looked up first in the JSDoc of the pinned version, and a promise of a stable API there is
  trusted within the major. Effect 4's repository is [`Effect-TS/effect`](https://github.com/Effect-TS/effect), not
  `effect-smol`. A dependency is never changed by hand, in `node_modules`, in bun's cache or by a patch.

## Pins and the CI

- Bun is pinned by `packageManager` in `package.json`, as the workflow installs it. A move of Bun runs the spikes.
- A move of Effect's version pins `effect` and every `@effect/` package together, the drivers `@effect/sql-pg` and
  `@effect/sql-pglite` among them, as a test of `src/form.test.ts` checks. The move runs
  `bun scripts/compare-docs.ts <old> <new>`, runs the spikes, and reads Effect's release policy again. A move to a new major reads every rule
  that rests on Effect again.
- The workflow [`.github/workflows/ci.yml`](.github/workflows/ci.yml) runs the checks on Linux on every push and pull
  request: `bun audit`, `bun run typecheck`, `bun run links`, and the audit and the build of the site. It runs
  `bun test` in four jobs, each with `--shard`, and jobs of their own run `bun run test:spikes` and
  `bun run test:postgres` against a container of PostgreSQL. A test of
  `src/form.test.ts` checks that the jobs run every shard and every script. A change of the storage or of a statement
  passes the job of PostgreSQL once the owner pushes `main`, since PGlite runs one session and hides what a pool does.
  Where no `POSTGRES_URL` names a server, the report of the step says that the job is owed at the push. Run by
  hand from the repository's Actions, the workflow also runs `bun run test:release`. The site's audit ignores one
  advisory of minimatch, and the workflow's comment says when the ignore goes.

## The documents

- A word the design gives a meaning of its own is defined once, in [`docs/glossary.md`](docs/glossary.md). A change
  that adds, renames or drops such a word changes the glossary in the same commit.
- Four diagrams show the design: an entity's loop in [`README.md`](README.md), the same loop whole under A program in
  [`docs/design.md`](docs/design.md), the life of an entity in [`docs/concepts.md`](docs/concepts.md), and the
  modules of `src/` with the storage's tables in [`CONTRIBUTING.md`](CONTRIBUTING.md). A change that adds, removes or
  renames a piece a diagram shows changes that diagram in the same commit.
- The design follows effect-tea's Guide (`README.md` of `github.com/fgaudo/effect-tea`) wherever the Guide applies.
  `docs/design.md` says where a server departs from it, and why.
- The site is built by [`site/build.ts`](site/build.ts) with TypeDoc, pinned in `site/package.json`. A warning of
  TypeDoc fails the build, so every export of the three entries has a doc comment that says what it takes and gives.
  An inferred name no declaration holds is excused in `site/typedoc.json`, and an export never is. A change of
  `src/`, of the guide or of an example builds the site before it is committed. The workflow
  [`.github/workflows/docs.yml`](.github/workflows/docs.yml) deploys the site from `main` once `ci.yml` passes.
- Each example has a `README.md`: its title, a paragraph on what it shows, and a line for each of its files. The
  site's page of an example is that README, followed by its files.
- A block of TypeScript of the guide or of the README is code of an example, cut at elisions. The test
  `the guide's code is found in the examples, part by part` in `src/form.test.ts` checks it.
