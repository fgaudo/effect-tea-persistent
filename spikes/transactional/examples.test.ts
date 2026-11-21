/**
 * The examples' own runtime tests pass on the spike's runtime. The test files run as they are, in a `bun test` of
 * their own that preloads `examples.preload.ts`, which gives them the spike's `launch`.
 *
 * `examples/subscription` has no test on a runtime, so `runtime.test.ts` runs it here. Four tests are left out,
 * each for a piece the roadmap parks: three of `examples/order` read the log through its consumers, and one of
 * `examples/rental` renames a program.
 */
import { expect, test } from 'bun:test'
import { join } from 'node:path'

const root = join(import.meta.dir, '..', '..')

const files = [
  'examples/quick-start/hold.test.ts',
  'examples/booking/runtime.test.ts',
  'examples/rental/runtime.test.ts',
  'examples/order/runtime.test.ts',
]

const parked = [
  'what an order published is what another system learns of it, each consumer in its topic',
  'a report built from the log counts the orders in each status, as the read model counts them',
  'readers that divide the partitions read each row once, and a reader that waits reads the next',
  'a bike renamed by the launch keeps its state under its new name',
]

const literal = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

test('the runtime tests of the examples pass on the spike, but those of a parked piece', async () => {
  const others = `^(?!.*(${parked.map(literal).join('|')}))`
  const child = Bun.spawn(
    ['bun', 'test', '--preload', './spikes/transactional/examples.preload.ts', '-t', others, ...files],
    { cwd: root, stdout: 'pipe', stderr: 'pipe' },
  )
  const [output, errors, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  const report = output + errors
  const counted = (what: string) => Number(new RegExp(`(\\d+) ${what}`).exec(report)?.[1] ?? Number.NaN)
  expect({ code, pass: counted('pass'), fail: counted('fail'), out: counted('filtered out') })
    .toEqual({ code: 0, pass: 17, fail: 0, out: parked.length })
}, 120_000)
