/**
 * The entry of a user's tests: a rehearsal of a program with no database to set up and no clock, the checks of its
 * projection and of its migrations, and the digest of a key, for a test that checks the key a service received
 * (decision 0193). The rehearsal imports `@effect/sql-sqlite-node`, an optional peer dependency.
 * The scheduler of the library's own tests stays in `testing.ts`, and is no part of it.
 *
 * @module @fgaudo/effect-tea-persistent/testing
 */
export { digestOf } from './machine.ts'
export {
  accepted,
  EntitySuspended,
  type Member,
  type Outside,
  type Pending,
  type Rehearsal,
  rehearse,
  rejected,
  type World,
} from './rehearse.ts'
export {
  type Allows,
  type Candidate,
  type MigrationCase,
  migrationViolations,
  type MigrationViolation,
  projectionViolations,
  type ProjectionViolation,
} from './testing.ts'
