export const meta = {
  name: 'roadmap',
  description: 'Do the open steps of docs/roadmap.md in order, each on the model it names, each reviewed before the next',
  whenToUse: 'The owner asks to go on with the roadmap with no one to ask. args.steps bounds the steps of one run.',
  phases: [
    { title: 'Choose', detail: 'find the first open step of the roadmap' },
    { title: 'Do', detail: 'one agent does the step, on the model and effort the step names' },
    { title: 'Review', detail: 'an agent that did not write the step checks its commits' },
    { title: 'Mend', detail: 'a new commit mends what a review found' },
  ],
}

// The run of AGENTS.md, "A run with no one to ask". One agent writes at a time, so that no two commits meet on main.

const STEPS = args && Number.isInteger(args.steps) ? args.steps : 20
// A step is given to three agents at most, and its commits to three reviews at most. A step that needs more is too
// large or too unclear for a run with no one to ask, and the run stops on it.
const AGENTS_OF_A_STEP = 3
const REVIEWS_OF_A_STEP = 3

const NAMES = { haiku: 'Claude Haiku 5.5', sonnet: 'Claude Sonnet 5.5', opus: 'Claude Opus 5.5', fable: 'Claude Fable 5.2' }

const NEXT_FIELDS = {
  found: { type: 'boolean', description: 'Whether a step of Next can be done now' },
  number: { type: 'integer', description: "The step's number in the roadmap" },
  title: { type: 'string', description: "The step's title, as the roadmap writes it in bold" },
  model: { type: 'string', enum: ['haiku', 'sonnet', 'opus', 'fable'] },
  effort: { type: 'string', enum: ['low', 'medium', 'high', 'xhigh'] },
  waiting: { type: 'array', items: { type: 'integer' }, description: 'The steps of Next that wait for the owner' },
}

const NEXT = { type: 'object', properties: NEXT_FIELDS, required: ['found', 'waiting'] }

const WORK = {
  type: 'object',
  properties: {
    status: {
      type: 'string',
      enum: ['done', 'partial', 'waits'],
      description: 'done: the step left the roadmap. partial: the roadmap names the part next. waits: the owner decides',
    },
    base: { type: 'string', description: 'The hash of HEAD before your first commit' },
    commits: { type: 'array', items: { type: 'string' }, description: 'The hashes of your commits, oldest first' },
    decisions: { type: 'array', items: { type: 'string' }, description: 'Each decision you took, in a line' },
    answers: { type: 'array', items: { type: 'string' }, description: 'For each finding you did not mend, why' },
    owed: { type: 'array', items: { type: 'string' }, description: "What waits for the owner's push, in a line each" },
    question: { type: 'string', description: 'The question you wrote for the owner, where the status is waits' },
    summary: { type: 'string', description: 'What changed, in five lines at most' },
  },
  required: ['status', 'base', 'commits', 'decisions', 'owed', 'summary'],
}

const REVIEW = {
  type: 'object',
  properties: {
    pass: { type: 'boolean', description: 'True only with no finding' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          where: { type: 'string', description: 'The file and line, or the document and section' },
          what: { type: 'string', description: 'What is wrong' },
          shown: { type: 'string', description: 'The command, the test or the value of AGENTS.md that shows it' },
        },
        required: ['where', 'what', 'shown'],
      },
    },
    summary: { type: 'string' },
    ...NEXT_FIELDS,
  },
  required: ['pass', 'findings', 'summary'],
}

const ALONE = `You work alone in this repository, in a run with no one to ask. AGENTS.md is in your context, and its
section Deciding says what you decide and what is the owner's. Never push, never open or comment an issue or a pull
request, never publish, never write to anyone, and never add or remove a dependency. Change no file outside this
repository, and no memory file.`

const FIRST_OPEN = `Read docs/roadmap.md. Take the steps under "Next" in the order of the file. The step to do is the
first one such that every step it depends on has left the file, and that does not say it waits for the owner. A step
that depends on a count of open bugs can be done only while docs/bugs.md lists that many at most. Give the step's
number, its title, and the model and effort it names, as opus and high for "(Opus 5.5 · high)". List in waiting the
number of each step of Next that waits for the owner. Where no step can be done, found is false.`

const CLOSING = `Commit on main, as AGENTS.md says of a commit, with a line of the body for each decision. A commit
ends with the trailer "Assisted-by: <your model>" and holds no Co-Authored-By. Commit only what passes the checks
that AGENTS.md and CONTRIBUTING.md name for what you changed. Never amend a commit of another agent. Leave the
working tree clean.

What you find and do not fix is a failing test, a bug of docs/bugs.md, a question of docs/open-questions.md or a
step of the roadmap, never a line of your report alone.

Report the status, the hash of HEAD before your first commit, the hashes of your commits, each decision in a line,
what waits for the owner's push, as the job of PostgreSQL where no POSTGRES_URL names a server, and a summary.`

const doing = (step) => `${ALONE}

Do step ${step.number} of docs/roadmap.md, "${step.title}", to its end. You are ${NAMES[step.model]}.

- Begin with git status and git log -5. Changes not committed are an earlier agent's work on this step: read them,
  and keep what is sound.
- Read the step and what it names. Take each decision of the step by the values of AGENTS.md, in their order, and
  keep a line for each.
- The step is done as its "It is done when" says, and no sooner.
- Close the step as the roadmap says. The step leaves docs/roadmap.md, and what a later step needs and the code
  does not show is written on that later step.
- Where the step cannot go on without what is the owner's, write the question under "For the owner" of
  docs/open-questions.md, write on the step that it waits for the owner and for which question, commit, and report
  the status waits.
- Where you must stop before the end, write on the step the parts done and the part next, commit what passes the
  checks, and report the status partial.

${CLOSING}`

const reviewing = (step, base, work, last) => `${ALONE}

Review step ${step.number} of the roadmap, "${step.title}". Another agent did it in the commits ${base}..HEAD, and
you did not write them. Read them with git log and git diff. The step's text is what
"git show ${base}:docs/roadmap.md" prints. You commit nothing${last ? ', but for what the last paragraph asks' : ''},
and a file you edit to try something is put back before you report.

The agent's summary: ${work.summary}
Its decisions: ${JSON.stringify(work.decisions)}
Its answers to an earlier review: ${JSON.stringify(work.answers || [])}

Check each point, and give each failure as a finding.
1. What the step's "It is done when" asks holds.
2. bun run typecheck, bun test and bun run links pass. A change of the runtime passes bun run test:release too, and
   a change of src/, of the guide or of an example builds the site. A test that fails by its timeout alone is run
   again by itself: where it passes, it is the open question on the tests that time out on Windows, and no finding.
3. Each behaviour the commits add or change has its sentence in docs/design.md, and a test that fails without it.
   Take a fix out, see its test fail, and put the fix back.
4. Each decision is the one the values of AGENTS.md give, in their order. Read the diff for the decisions the report
   does not name. A decision is a finding only where another ranks higher by a value, and the finding names the
   value. A matter of taste is no finding.
5. Nothing in the code added fails in silence, and nothing added could be taken out.
6. docs/roadmap.md, docs/bugs.md and docs/open-questions.md are true of the code, and a session that knows nothing
   of this run could do the next step from them. The budgets of AGENTS.md hold, or a commit raised one and says why.
7. Nothing left this machine, and no dependency was added or removed: read git status -sb, package.json and bun.lock.

Pass only with no finding. Then answer this too, for the step after this one: ${FIRST_OPEN}
${
  last
    ? `
This is the last review of the step in this run. If it does not pass, write each finding where the next session
looks, as a bug of docs/bugs.md with its test.failing or as a question of docs/open-questions.md, commit those files
alone as AGENTS.md says of a commit, and still report the findings.`
    : ''
}`

const mending = (step, base, review) => `${ALONE}

A review of step ${step.number} of the roadmap, "${step.title}", read the commits ${base}..HEAD and found what
follows. You are ${NAMES[step.model]}. Mend each finding by a new commit. Where a finding is none, by a value of
AGENTS.md you name, say so in a line of answers, and mend nothing for it.

The findings: ${JSON.stringify(review.findings, null, 2)}

${CLOSING}`

const chosen = (answer) =>
  answer && answer.found && Number.isInteger(answer.number) && answer.model && answer.effort
    ? { number: answer.number, title: answer.title || '', model: answer.model, effort: answer.effort }
    : null

const choose = (label) =>
  agent(`${FIRST_OPEN} Change no file.`, { label, phase: 'Choose', model: 'sonnet', effort: 'medium', schema: NEXT })

const run = { done: [], waiting: [], decisions: [], owed: [], commits: [], stopped: null }

const keep = (step, work) => {
  run.commits.push(...work.commits)
  run.decisions.push(...work.decisions.map((line) => `step ${step.number}: ${line}`))
  run.owed.push(...work.owed.map((line) => `step ${step.number}: ${line}`))
}

let step = chosen(await choose('the first open step'))

while (step !== null && run.stopped === null && run.done.length + run.waiting.length < STEPS) {
  const name = `step ${step.number}`
  log(`${name}, "${step.title}", on ${NAMES[step.model]} at ${step.effort}`)

  let work = null
  let base = null
  const decisions = []
  for (let round = 1; round <= AGENTS_OF_A_STEP; round++) {
    work = await agent(doing(step), {
      label: round === 1 ? `${name}: do` : `${name}: do, agent ${round}`,
      phase: 'Do',
      model: step.model,
      effort: step.effort,
      schema: WORK,
    })
    if (!work) break
    base = base || work.base
    keep(step, work)
    decisions.push(...work.decisions)
    if (work.status !== 'partial') break
  }
  if (!work) {
    run.stopped = `${name}: its agent ended with no report, and git status says what it left`
    break
  }
  if (work.status === 'partial') {
    run.stopped = `${name}: not done after ${AGENTS_OF_A_STEP} agents, and the roadmap names the part next`
    break
  }
  if (work.status === 'waits') {
    run.waiting.push({ step: step.number, title: step.title, question: work.question || work.summary })
    log(`${name} waits for the owner`)
    step = chosen(await choose(`the step after ${name}`))
    continue
  }

  // A design that Fable wrote is reviewed by Fable, and any other step by Opus, each at high.
  const reviewer = step.model === 'fable' ? 'fable' : 'opus'
  let review = null
  for (let round = 1; round <= REVIEWS_OF_A_STEP; round++) {
    const last = round === REVIEWS_OF_A_STEP
    review = await agent(reviewing(step, base, { ...work, decisions }, last), {
      label: `${name}: review ${round}`,
      phase: 'Review',
      model: reviewer,
      effort: 'high',
      schema: REVIEW,
    })
    if (!review || review.pass || last) break
    log(`${name}: review ${round} found ${review.findings.length}`)
    const mended = await agent(mending(step, base, review), {
      label: `${name}: mend ${round}`,
      phase: 'Mend',
      model: step.model,
      effort: step.effort,
      schema: WORK,
    })
    if (!mended) {
      review = null
      break
    }
    keep(step, mended)
    decisions.push(...mended.decisions)
    work = mended
  }
  if (!review) {
    run.stopped = `${name}: an agent of its review ended with no report, and its commits are not reviewed`
    break
  }
  if (!review.pass) {
    run.stopped = `${name}: failed its review ${REVIEWS_OF_A_STEP} times, and its findings are bugs or questions now`
    run.findings = review.findings
    break
  }
  run.done.push({ step: step.number, title: step.title, review: review.summary })
  // A review that names no next step, without saying that none is found, did not look for one.
  step = chosen(review) || (review.found === false ? null : chosen(await choose(`the step after ${name}`)))
}

if (run.stopped === null) {
  run.stopped =
    step === null
      ? 'no step of Next can be done: each is done, waits for the owner, or depends on one that does'
      : `the run did its ${STEPS} steps, and step ${step.number} is next`
}
log(run.stopped)
return run
