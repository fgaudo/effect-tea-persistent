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
- A bug found is added at the end, under the next number. The next number is 125.

## The list

- **1. A droppable operation that a new program delivers at most once never runs.** `renew` of `src/machine.ts`
  keeps the incarnation of an operation that is the same work under another delivery. `activate` then reads that
  incarnation as an at-most-once run that may have acted, and records its `unknown` instead of starting it. The run
  stopped was droppable, so it acted on nothing. A program that answers `unknown` by not acting again never acts. The
  test is `a droppable operation a new program delivers at most once starts, since it acted on nothing`, in
  `src/machine.test.ts`. The fix begins at `activate`, which would give `unknown` only to an incarnation stored as run
  at most once, or at `renew`, which would draw a new incarnation for a droppable operation delivered otherwise. It is
  a case of step 10 of the [roadmap](roadmap.md).
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
- **124. A query refuses a criterion whose string is longer than 254 bytes, though the criterion keys no row.**
  `isCompared` of `src/storage/projections.ts` takes a string only where `isText` holds. Since `ec36292`, `isText`
  also bounds the JSON of a text at 256 bytes, so that PostgreSQL can hold the text in an entry of an index. A
  criterion's value is a parameter of the statement, and is never written in an index. Each dialect compares a long
  string as it compares a short one. So `query` with `rank < 'c'.repeat(256)` fails as the caller's defect, where
  both dialects would find every row below it. The second value of `AGENTS.md` refuses only a misuse that leaves the
  behaviour undefined. The test is `a criterion whose string is past the bound of a text that keys a row is compared,
  on both dialects`, in `src/storage.test.ts`. The fix checks a criterion's string for U+0000 and lone surrogates
  alone, and `docs/design.md` says under `query` that a criterion's string has no bound.
