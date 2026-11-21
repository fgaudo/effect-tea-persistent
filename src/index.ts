/**
 * The library's main entry: what a program, its boundary and an operator use on one process. A program's module
 * alone is in `index.program.ts`, and a test's helpers in `index.testing.ts`, so that a process imports the
 * checks of a test only where it uses them.
 *
 * @module @fgaudo/effect-tea-persistent
 */
export * from './index.program.ts'
export { check, type Checked, type CheckedEntities, type CheckFailure } from './check.ts'
export {
  type Answer,
  type Handle,
  type Inspected,
  type Keep,
  launch,
  type Operated,
  type Options,
  type Runtime,
  type Suspended,
  type Waiting,
} from './runtime.ts'
export {
  type After,
  type Comparison,
  createTables,
  type Criterion,
  type Found,
  type Query,
  type Reindexed,
  type Suspension,
} from './storage.ts'
