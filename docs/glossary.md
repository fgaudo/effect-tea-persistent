# Glossary

The words of [`design.md`](design.md) and of the notes, each defined once. A word used in a sense of Effect's says
so.

- **Activation.** The runtime reads an entity's state, incarnations and stored work, computes `work(state)`,
  compares it with the stored work, starts its operations and arms its timers. An entity is activated in its first
  transaction of a launch, and again once the process forgets it, since the process remembers the last 10,000 it
  activated. A restart and a deploy each end in one.
- **Boundary.** The code that calls a deployment's `create`, `send` and `read` for a caller: it authenticates the
  caller, and writes the sender. The runtime trusts the sender the boundary gives, and `read` takes none.
- **Check.** `check(program, { limit })` reads every stored entity of a program, before its deploy, as an
  activation of the new program would, and gives the entities it would not run, with the cause of each. It launches
  nothing and writes nothing.
- **Child, parent.** A part a program or another part holds in its state, declared in its `children` with `child`
  for one, or `each` for children by id; the one that holds it is its parent. The library routes a child's messages,
  holds its work under `<child>.<key>`, and runs its operations under `<child>.<tag>`.
- **Crash.** The process dies at a point of the crash table. A transaction that fails rolls back, and stores
  nothing of its event.
- **Defect.** What the program does that it should not: a function or a schema of its that throws, or a rule of the
  design it breaks. A defect suspends the entity. A bug of the runtime's rolls back its transaction instead, and
  suspends nothing.
- **Delivery.** What a crash does to an operation, and what an idempotent one is given, declared by its runner:
  *idempotent*, run again with the same idempotency key, readable or as its digest; *at least once*, run again; *at
  most once*, not run again, its `unknown` message delivered instead; *droppable*, acting on nothing, run again, and
  interrupted when a step drops it or changes it.
- **Deploy, deployment.** `deploy(program, options)` gives a handle to one program's entities, under the program's
  name. The option `outbox` makes the program's steps write the outbox. A new version, a fix included, is deployed by
  a new process. So the deploy of a program in a runtime and the deployment of its version to production are one
  act, and the word names both.
- **Dialect.** The SQL a database speaks: SQLite or PostgreSQL, the two the storage speaks, in the same tables. A
  query finds and orders the same rows in both.
- **Entity.** One long-lived thing with an id, an order or a booking, with one state, one mailbox and one message
  handled at a time.
- **Event.** What moves the machine: a message arriving, an operation completing or dying, a timer firing, a step, the
  process dying, an operator resuming or discarding. What a child tells its parent is a raised event, not an event.
- **External message.** What a parent sends a child through `children.<child>.update`, of a type the child's schema
  `external` gives. It is no inbound message: no caller can send it, and a child takes it in every state.
- **Flags.** What an entity is created with, which `init` reads and nothing else keeps. A program's `init` may
  reject them, and the entity is then not created.
- **Handle.** What `deploy` gives: `create`, `send`, `read` and `query` for callers, `reindex` and `expire`, and
  `suspended`, `inspect`, `resume` and `discard` for an operator.
- **Idempotency key.** The entity's program and id, the operation's key and its incarnation, given to an idempotent
  operation, which passes it to the service it calls. A restarted operation gets the same one. Its *digest*, 43
  characters whatever the id's length, is given instead to a runner declared with `operation.digest`.
- **Incarnation.** The number of a run of a key's work, drawn from one counter of the entity each time work starts
  anew under any key, so it never goes back. An internal message carries the incarnation of the work that sent it,
  and is dropped once the key's has moved on.
- **Index.** A pure function from the projection to a scalar, named by the program, which a query filters and
  orders by. Its values are stored with the projection's row.
- **Key.** A name the program declares, under which `work` returns one piece of work, or one piece for each
  *parameter* of a key declared with a schema for it. Two parameters are one when they encode alike. The names are
  finite, and one the program does not declare is a defect.
- **Lock.** What a step's transaction takes of its entity first: an advisory lock of the transaction on PostgreSQL,
  and the one writer on SQLite. The process holds no lock of an entity of its own.
- **Machine.** The runtime's semantics as a pure state machine, in [`src/machine.ts`](../src/machine.ts): from an event
  to the next machine and the rows it writes. `rehearse` runs it, and the runtime interprets it.
- **Mailbox.** The entity's stored queue of messages, in order. A message is received and handled in the
  transaction that records it, unless the entity is suspended.
- **Message.** *Inbound*, from a caller, with a request id, answered `Accepted`, `Rejected`, `Suspended` or
  `NotFound`; or *internal*, from the entity's own work, a completion or a firing, carrying an incarnation.
- **Migration.** A record of pure functions from the JSON a version wrote to the JSON the next one reads, by kind of
  stored value. A program carries every migration it ever had, in order.
- **Migration case.** A JSON value a version wrote of one kind, and the JSON value the next version reads of it,
  recorded by a test when the migration is written. `migrationViolations` checks a program against its cases.
- **Name.** What the runtime stores a program's entities under, and what other entities address them by. A process
  deploys a name once.
- **Note.** A decision, numbered, in [`decisions/`](decisions); what one is, and when it is taken, is in
  [`AGENTS.md`](../AGENTS.md).
- **Operation.** Work that acts on the world, as a value of the program's own type. Its runner turns it into an effect
  that ends with an internal message. It leaves the state only through its completion, unless it is droppable: one
  that acts on nothing, which a step may drop or change while it runs.
- **Outbox.** The table `effecttea_outbox`, which a program deployed with `outbox: true` writes: one row at an
  entity's creation, and one at each step whose projection changed. A row is keyed by the entity's name, its id and
  its `step`, and holds the kind, the version, the time, the message and the projection. The rows of one entity
  commit in the order of `step`, and no order holds across entities. The library never deletes a row, and a reader
  deletes the rows it handled.
- **Part.** A child, as declared in `part(schemas)(…)`: a program's pieces without a name, indexes or migrations,
  which are its parent's, and with the schemas of the events it raises and the external messages it takes.
- **Probe.** The launch's option `probe`, a test's hook, which runs at three points of an event's transaction:
  `Recorded`, `BeforeCommit` and `AfterCommit`.
- **Program.** Everything declared in `program(schemas)(…)`: `name`, `keys`, `children`, `init`, `update`,
  `onEvent`, `work`, `operations`, `project`, `indexes` and `migrations`.
- **Projection, read model.** `project(state)`: what a caller reads of an entity, with the actions it allows, as
  JSON, a time as its milliseconds. Stored as a row with the value of each index, which `read` and a query read. The
  read model answers what the program's application reads to act; any other question over the entities is a
  *report*.
- **Reference, `reference`.** A program's name with its types, and none of its code, which `send` and `create`
  name a receiver by. `reference<typeof p>(name)` makes one, and the compiler checks the name against `p`'s.
- **Raised event.** What a child's `update` tells its parent with `raise(event)(state)`, handled by the parent's
  `onEvent` in the same step, and never stored.
- **Report.** A question over the entities the read model does not answer: a count, a grouping, a disjunction, a
  search in a text, a join across programs, a series over time. It is answered by a store made for it, which a
  reader of the outbox fills.
- **Rehearsal, `rehearse`.** A scenario run on the machine without storage or clock, where the test answers
  or runs the operations, fires the timers or lets time pass, kills the process and deploys new versions.
  `rehearse` runs one entity, and `rehearse.together` a world.
- **Reply.** The stored answer to a request, which a retry under the same request id reads. A caller's is kept for
  the `keep` its boundary gave `send`, from the step that answers, or for ever where the `keep` is `'forever'`. Another entity's is kept
  while the work that asked is stored. Another entity's `NotFound`, and its creation that `init` rejected, are kept
  the same way, though no entity stores them.
- **Request.** What identifies an inbound message: a caller's sender and request id with the message it carries, or
  the run of an operation and the name it gave `send`. A request is applied once, whichever retry finds it while its
  reply is kept. A caller's request under a used sender and request id that carries another message, or other flags
  for a creation, is answered `Reused`, and changes nothing.
- **Runner.** Of an operation: the function in `operations` that runs its kind.
- **Sweep.** What the runtime runs for each program at the interval `launch`'s `sweep` gives: `expire` alone, in
  batches.
- **Sender.** Who sent an inbound message, as the program's schema writes it, read in `update` as `meta.from`. Request
  ids are their sender's. A caller's sender is the identity the boundary authenticated.
- **Settled.** The runtime's wait until no operation runs in the process and no stored timer is due, which the
  tests use.
- **Spike.** A test in [`spikes/`](../spikes) that shows what a dependency does at the pinned version.
- **State.** The one truth of an entity, an object, stored after each step. Everything durable is derived from it.
- **Step.** `update` applied to one message: the next state, checked, and stored in one transaction that locks the
  entity, with the message, its reply, the work that changed, the row a query reads, and the row of the outbox
  where the program is deployed with it. An entity's count of steps after a write is the `step` of its row of the
  outbox.
- **Suspended.** An entity after a defect: its state stays, the message stays unhandled, its timers are disarmed, and
  nothing is handled until an operator resumes it or discards the message. Its operations run to their end, and
  their completions wait behind the message. A caller meanwhile is answered `Suspended`, which is no reply.
- **Text a database holds.** A string with no U+0000, which PostgreSQL holds in no text, and no lone surrogate,
  which no database gives back as written. An id, a request id, a name and a string an index holds are such text, or the defect of
  whoever gave them. An id and a program's name are not empty either.
- **Timer.** Work that delivers one internal message at its time, derived from the state. It may be dropped in any
  state, and one that changes is armed again as new work.
- **Types, `TypesOf`.** Of a program: the type of its state, flags, messages, operations, keys and their
  parameters, reasons, sender, projection, indexes and services, which `Program`, `Handle` and `Rehearsal` take.
  `TypesOf<typeof p>` gives them, of a program or of a reference to it.
- **Version.** Of a program: how many migrations it carries, plus one. Every row carries the version that wrote it,
  and is read by migrating its JSON to the program's.
- **Waker.** The fiber of a deployment that reads the entities with a timer due, fires each timer in a transaction
  of its entity, and sleeps until the earliest time stored, or until a step arms an earlier one. A due timer whose
  fire failed is read again after `retry`.
- **Work.** What the state holds under its keys, operations and timers, computed by `work(state)` and compared with
  the previous state's after each step: a new key starts its work, a missing one ends it. The notes before
  [decision 0195](decisions/0195-the-package-is-effect-tea-persistent.md) call it durable work, and the function
  `durable`.
- **World, member.** In a rehearsal: entities on the machine together, with one time and one process for all of them,
  made by `rehearse.together`. A member is one entity of a world, whose `run` runs an operation's runner, and what
  the runner sends reaches the receiver's machine.
