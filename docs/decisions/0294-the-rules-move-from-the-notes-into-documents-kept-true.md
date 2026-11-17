# 0294. The rules move from the notes into documents kept true, and the notes become records

**Status:** proposed, 2026-11-17, for the step The rules move from the notes into documents kept true, of the
[roadmap](../roadmap.md). The maintainer chose in a session of 2026-11-17 to move every rule and premise of the notes
into documents kept true of the code, as effect-tea keeps its own, and to keep the notes as records of why. The
maintainer chose in the same session that this step replaces what was left of the premise review. Its first part
is done: the step lists each note in one area. Area 4 is moved, and made [`docs/premises.md`](../premises.md) and
[`docs/rejected.md`](../rejected.md), with the test of `src/form.test.ts` that checks the premises. Area 1 is moved,
and its notes 0248, 0249, 0290 and 0291 lie in [`archive/`](archive). Area 2 is moved, and its notes 0245, 0253,
0265, 0269, 0282, 0285 and 0289 lie there too. The next part is area 3.

## Context

A note is never rewritten once taken. So a rule that changes is a later note, and what holds today of one rule is
spread over the note that made it and the notes that changed it. A premise is lost between two such notes, as
decision 0274 took away a premise of decision 0068 that no note wrote. The premise review was the answer: it read
every pair of notes that change each other, in two readings of every area of the index, with seventeen last
sessions and a sample. It found more than a hundred bugs of [`docs/bugs.md`](../bugs.md). It also wrote 7,600 lines
of [`reviews.md`](reviews.md), and needed `scripts/premise-pairs.ts`, which found 2,832 pairs of notes that one
declaration couples and that no note links. What was left of it on 2026-11-17 was area 14, the pairs the second
reading read in part, and twelve readings of one shared state.

A pair of notes is the wrong unit once the notes number in the hundreds. The pairs grow with the square of the notes,
and each later note adds pairs to read. effect-tea (`github.com/fgaudo/effect-tea`) keeps the same rigour another way.
Its `docs/premises.md` lists every premise of the code once, each with the test that checks it. Its
`docs/invariants.md` says how the code keeps each promise. Its `docs/rejected.md` lists what was weighed and
rejected, with what would reopen it. Its `docs/records/` hold the designs as they were decided, as history. A review
there reads one list.

[`docs/design.md`](../design.md) already says what holds of 159 notes, which lie in [`archive/`](archive). The 99
notes outside it are the rules that no document says whole yet.

## Decision

- **Every rule a note decides is said in a document kept true of the code.** A rule of the design is said in
  `docs/design.md`, as an archived note's rule is today. A rule of the project is said in the README, and a rule of
  work in `AGENTS.md`.
- **Every premise the code rests on today is a bullet of `docs/premises.md`.** A premise is written once, by the
  state it is in today, with its state in bold as one word of the closed set of `AGENTS.md`. A premise said tested
  names its test. A premise of an archived note that still holds is listed too, and a premise that no longer holds
  is not.
- **Every alternative a later proposal could bring again is an entry of `docs/rejected.md`.** An entry says what the
  idea was, why it was rejected, on what evidence, and what would reopen it. It links the record that weighed it.
- **A note becomes a record once its area is moved.** It moves to `archive/`, keeps its number and its text, and is
  read for why. A record is history and holds no rule. Where a record and a document differ, the document rules.
- **The step reads by shared state, not by pairs.** Its areas are the twelve shared states of the code that the
  premise review was to read last, and five areas for the notes of no shared state: the machine and the program,
  the rehearsal and the testing module, the schemas a program declares, the project, and the launch with the hold
  and the tables' migrations. Each note outside the archive is listed in exactly one area, but the notes of the
  steps under way. An area reads its notes whole, the archived notes the code of
  its state cites, and the declarations of its state that cite no note. It looks for a premise a later note took
  away, as a reading of one shared state of the premise review does. A finding is a bug of `docs/bugs.md`, or an open
  question where no test reproduces it yet.
- **An area is moved in one commit.** The commit writes the area's rules into the documents, its premises into
  `docs/premises.md` and its alternatives into `docs/rejected.md`, and moves its notes to `archive/`.
- **The rules of work on notes hold until the last part of the step.** A note taken while the step runs joins the
  area of its state. The notes `proposed` of a step under way, decisions 0283, 0292 and 0293, keep their steps as
  they are. When such a step ends, its rules go into the documents and its note becomes a record, instead of being
  taken.
- **The last part changes the rules of work.** `AGENTS.md` then says these rules in place of its section on notes.
  A design weighed for a step of the roadmap is a record of `docs/records/`, rewritten in place while the step is
  under way and marked done when the step leaves the roadmap, so that a session that knows nothing of the one before
  finds what the parts done decided. A comment that keeps a rule cites the section of the document that says it. A
  citation of a note already written stays, since the record keeps its number, and moves to the section when its
  code changes. A new premise is added to `docs/premises.md` only once the maintainer agrees, before the code that
  rests on it is written. The checks of `src/form.test.ts` on the section `What it rests on` of the notes check
  `docs/premises.md` instead, and a record is not checked. A rename of a test then fixes `docs/premises.md`, and no
  record. A review reads `docs/premises.md`, by [`.claude/skills/premise-review/SKILL.md`](../../.claude/skills/premise-review/SKILL.md)
  written again for it, and `scripts/premise-pairs.ts` goes. [`docs/bugs.md`](../bugs.md) says that a fix changes
  the documents and the test, and no longer that it is a note.

## What it rests on

- That a reading of every pair of notes costs more than it finds, once the notes number in the hundreds: **chosen**
  by the maintainer, on 2026-11-17, after the two readings of the premise review.
- That one list of premises kept true lets a review read one file, and keeps a premise from being lost between two
  notes: **chosen** by the maintainer, on 2026-11-17, from effect-tea's practice.
- That a citation of a note in a comment or a document still resolves once the note lies in `archive/`: **tested**
  by `bun run links`, which finds a cited note in `docs/decisions/` and in `docs/decisions/archive/`.
- That an area finds every premise of its state by its notes, the archived notes its code cites and the declarations
  of its state that cite no note: **open**. `bun scripts/premise-pairs.ts --tables` lists declarations that cite no
  note, such as `entitiesOf.entities` and `logOf.heads`. Each area reads them, and its report says what it read.
- That a document kept true stays true of the code where a check holds it: **open**. The check is a test of
  `src/form.test.ts` that every premise of `docs/premises.md` names a state of the closed set, and that each test it
  names exists. It is written by the part of the step that makes `docs/premises.md`, and fails on a sample of each
  case before that part is committed, as decision 0254 asks of a check of the project.
- That a session continuing a step finds what the parts done decided in a record as it found it in a note
  `proposed`: **chosen** by this note.

## Alternatives

- **The premise review finished by pairs, and the notes kept as the rules.** Each later note adds pairs, so the
  review is never done, and a rule stays spread over several notes.
- **A script that writes `docs/premises.md` from the sections `What it rests on` of the notes.** Which premise still
  holds is the judgment the review needed, and no script makes it. The list would hold premises that a later note
  took away, and read as true.
- **The notes rewritten, and their citations in the code rewritten at once.** The code cites the notes 1,853 times in
  114 files. A rewrite costs much, risks the why the notes keep, and checks nothing a citation of a record does not.
- **Documents kept true beside notes that still rule.** Two sources of one rule disagree in time, and a reader cannot
  tell which rules.

## Consequences

- The step of the premise review leaves the roadmap. Its readings of one shared state become the areas of this step.
  What it found is in `docs/bugs.md`, in [the open questions](../open-questions.md) and in `reviews.md`, which stays
  as it is.
- `scripts/premise-coverage.ts`, which checked the review's step, goes with it.
- Where the tests of the review's bugs lie, on branches of the maintainer's machine, is said in `docs/bugs.md`.
