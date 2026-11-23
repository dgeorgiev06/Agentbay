import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

type Opts = { label?: string, agentType?: string }
type Agent = (prompt: string, opts: Opts) => Promise<unknown>

const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor

function load(name: string) {
  const url = new URL(`../workflows/${name}.js`, import.meta.url)
  return readFileSync(url, 'utf8').replace(/^export const meta/m, 'const meta')
}

async function run(name: string, agent: Agent, args: unknown) {
  const body = new AsyncFunction('agent', 'pipeline', 'parallel', 'phase', 'log', 'args', load(name))
  const parallel = (thunks: Array<() => Promise<unknown>>) => Promise.all(thunks.map(thunk => thunk()))
  return body(agent, () => assert.fail('pipeline unused'), parallel, () => {}, () => {}, args)
}

function slice(id: string, depends_on: string[] = []) {
  return { id, title: `title ${id}`, done: 'works', files: [`${id}.ts`], depends_on }
}

function fakeBuild(slices: object[], passesOnRound: Record<string, number>) {
  const calls: string[] = []
  let active = 0
  let peak = 0
  const agent: Agent = async (_prompt, { label = '' }) => {
    calls.push(label)
    const [id, step, round] = label.split(' ')
    if (label === 'load plan') return { repo: '.', interfaces: [], slices }
    if (step === 'tests') return { test_command: `node --test hidden/${id}`, files: [] }
    if (step === 'run') {
      return { passed: Number(round) >= passesOnRound[id], failures: [{ name: 't', message: 'm' }] }
    }
    if (step === 'review') return { verdict: 'pass', must: [], should: [] }
    active += 1
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active -= 1
    return 'built'
  }
  return { agent, calls, peak: () => peak }
}

test('plan returns the lead slices and saves the plan', async () => {
  const lead = { slices: [slice('S1'), slice('S2', ['S1'])], interfaces: [], open_questions: ['q'] }
  const result = await run('plan', async (_p, opts) => (opts.agentType === 'dev:lead' ? lead : 'ok'), {
    requirements: 'req.md',
  })
  assert.deepEqual(result.slices, ['S1: title S1', 'S2: title S2'])
  assert.equal(result.plan, './.agentbay/dev/plan.json')
})

test('a slice passing on round 2 ends pass; failing twice ends needs-decision', async () => {
  const fake = fakeBuild([slice('S1'), slice('S2')], { S1: 2, S2: 3 })
  const { slices } = await run('build', fake.agent, { plan: 'plan.json' })
  assert.deepEqual(slices.map((s: { status: string }) => s.status), ['pass', 'needs-decision'])
  assert.equal(fake.calls.filter(label => label.startsWith('S2 build')).length, 2)
  assert.deepEqual(slices[1].failures, [{ name: 't', message: 'm' }])
})

test('dependents of a failed slice wait and builders never exceed the cap', async () => {
  const fake = fakeBuild([slice('S1'), slice('S2'), slice('S3'), slice('S4', ['S1'])], { S1: 3, S2: 1, S3: 1 })
  const { slices } = await run('build', fake.agent, { plan: 'plan.json' })
  assert.equal(fake.peak(), 2)
  assert.equal(slices.at(-1).status, 'needs-decision')
  assert.ok(!fake.calls.some(label => label.startsWith('S4')))
})

test('workflows avoid what the runtime forbids', () => {
  for (const name of ['plan', 'build']) {
    assert.match(load(name), /^const meta = \{/)
    assert.doesNotMatch(load(name), /Date\.now|Math\.random|new Date\(\)|import\(|^import /m)
  }
})
