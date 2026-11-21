# effect-tea-persistent — guide for coding agents

This repository is a design and its pure core, not a library yet. Read [`README.md`](README.md), then
[`docs/design.md`](docs/design.md), with [`docs/glossary.md`](docs/glossary.md) at hand. What to do next is the first
step of [`docs/roadmap.md`](docs/roadmap.md). [`docs/review-2026-11.md`](docs/review-2026-11.md) says why the work
starts again from the pure core, and what the maintainer chose.

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
- **Budgets.** The runtime and the storage, without tests, stay under 2,500 lines together. `docs/design.md` stays
  under 600 lines, `AGENTS.md` under 120 and `docs/roadmap.md` under 150. A change that crosses a budget is the
  maintainer's choice, and the maintainer sets the numbers.
- **No feature while more than ten bugs are open.**
- **What a session finds is a failing test, a bug of `docs/bugs.md` or a question of `docs/open-questions.md`.** A
  finding is never left in a report or in the chat alone. A bug fixed leaves its file, and git keeps it.
- **A step under way can be continued by a session that knows nothing of the one before it.** Before a session stops
  inside a step, the step in the roadmap names the parts done and the part next, and what only the conversation held
  is written there: a premise found, a test still red, a choice the maintainer made in chat.

## Prose and commits

- All code, comments, identifiers, commit messages and `.md` files are in **English**.
- A commit made with an AI agent ends with an `Assisted-by: <model>` trailer, never `Co-Authored-By`.
- Work is committed on `main`, with no branch first, even to run a job of the CI before the work reaches `main`. A
  branch is only for a session that works beside another one.
- A commit message stays short: a subject line of at most 72 characters in the imperative, and a body only where
  the diff cannot say it, four lines at most.
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
  example holds from the README and `docs/` alone. The reader is a subagent only once the maintainer agrees, and
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
  says in a comment what the module does not do. An unstable module that `src/` does not import yet is used only
  once the maintainer agrees.
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
  passes the job of PostgreSQL on the push of `main`, since PGlite runs one session and hides what a pool does. Run by
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
