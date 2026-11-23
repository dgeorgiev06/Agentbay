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
  const names = ['agent', 'pipeline', 'parallel', 'phase', 'log', 'args']
  const body = new AsyncFunction(...names, load(name))
  const parallel = (thunks: Array<() => Promise<unknown>>) => {
    return Promise.all(thunks.map(thunk => thunk()))
  }
  return body(agent, () => assert.fail('pipeline unused'), parallel, () => {}, () => {}, args)
}

function slice(id: string, depends_on: string[] = []) {
  return { id, title: `title ${id}`, done: 'works', files: [`${id}.ts`], depends_on }
}

type Reply = Record<string, unknown> | null

const PASS = { verdict: 'pass', must: [], should: [] }

function fakeBuild(passesOnRound: Record<string, number>, review: Reply = PASS) {
  const prompts: Record<string, string> = {}
  const calls: string[] = []
  let active = 0
  let peak = 0
  const agent: Agent = async (prompt, { label = '' }) => {
    calls.push(label)
    prompts[label] = prompt
    const [id, step, round] = label.split(' ')
    if (step === 'tests') {
      return { test_command: 'node --test', files: [{ path: 'a.test.ts', content: '' }] }
    }
    if (step === 'run') {
      return { passed: Number(round) >= passesOnRound[id], failures: [{ name: 't', message: 'm' }] }
    }
    if (step === 'review') return review
    active += 1
    peak = Math.max(peak, active)
    await new Promise(resolve => setTimeout(resolve, 5))
    active -= 1
    return 'built'
  }
  return { agent, calls, prompts, peak: () => peak }
}

function plan(slices: object[]) {
  return { repo: '.', interfaces: [], slices }
}

test('plan returns the lead plan with the repo and writes nothing', async () => {
  const slices = [slice('S1'), slice('S2', ['S1'])]
  const lead = { slices, interfaces: ['i'], open_questions: ['q'] }
  const prompts: string[] = []
  const agent: Agent = async prompt => {
    prompts.push(prompt)
    return lead
  }
  const result = await run('plan', agent, { requirements: 'req.md', repo: 'app' })
  assert.deepEqual(result.plan, { repo: 'app', slices: lead.slices, interfaces: ['i'] })
  assert.deepEqual(result.open_questions, ['q'])
  assert.equal(prompts.length, 1)
})

test('a slice passing on round 2 ends pass; failing twice ends needs-decision', async () => {
  const fake = fakeBuild({ S1: 2, S2: 3 })
  const { slices } = await run('build', fake.agent, { plan: plan([slice('S1'), slice('S2')]) })
  assert.deepEqual(slices.map((s: { status: string }) => s.status), ['pass', 'needs-decision'])
  assert.equal(fake.calls.filter(label => label.startsWith('S2 build')).length, 2)
  assert.deepEqual(slices[1].failures, [{ name: 't', message: 'm' }])
})

test('hidden tests go to the runner and never into the builder prompt', async () => {
  const fake = fakeBuild({ S1: 1 })
  await run('build', fake.agent, { plan: plan([slice('S1')]) })
  assert.match(fake.prompts['S1 run 1'], /agentbay-dev\/S1\/.*a\.test\.ts/s)
  assert.doesNotMatch(fake.prompts['S1 build 1'], /hidden|a\.test\.ts/)
})

test('dependents of a failed slice wait and builders never exceed the cap', async () => {
  const fake = fakeBuild({ S1: 3, S2: 1, S3: 1 })
  const slices = [slice('S1'), slice('S2'), slice('S3'), slice('S4', ['S1'])]
  const result = await run('build', fake.agent, { plan: plan(slices) })
  assert.equal(fake.peak(), 2)
  assert.equal(result.slices.at(-1).status, 'needs-decision')
  assert.ok(!fake.calls.some(label => label.startsWith('S4')))
})

test('reviewer must findings reach the round-2 builder prompt', async () => {
  const must = [{ id: 'R1', rule: 'M4', file: 'S1.ts', what: 'comment found' }]
  const fake = fakeBuild({ S1: 1 }, { verdict: 'fix', must, should: [] })
  const { slices } = await run('build', fake.agent, { plan: plan([slice('S1')]) })
  assert.match(fake.prompts['S1 build 2'], /R1 \[M4\] S1\.ts: comment found/)
  assert.equal(slices[0].status, 'needs-decision')
  assert.deepEqual(slices[0].must, must)
})

test('a stopped reviewer ends the slice as needs-decision', async () => {
  const fake = fakeBuild({ S1: 1 }, null)
  const { slices } = await run('build', fake.agent, { plan: plan([slice('S1')]) })
  assert.equal(slices[0].status, 'needs-decision')
  assert.equal(slices[0].reason, 'The reviewer stopped.')
  assert.equal(fake.calls.filter(label => label.startsWith('S1 build')).length, 1)
})

test('bad args return an error before any agent starts', async () => {
  const agent: Agent = async () => assert.fail('no agent expected')
  const good = plan([slice('S1')])
  const bad = [
    { args: {}, error: /args\.plan/ },
    { args: { plan: { slices: [{ id: 'S1' }] } }, error: /Every plan slice/ },
    { args: { plan: good, parallel: 0 }, error: /positive whole number/ },
    { args: { plan: good, parallel: 1.5 }, error: /positive whole number/ },
    { args: { plan: good, parallel: '2' }, error: /positive whole number/ },
  ]
  for (const { args, error } of bad) {
    assert.match((await run('build', agent, args)).error, error)
  }
})

test('workflows avoid what the runtime forbids', () => {
  for (const name of ['plan', 'build']) {
    assert.match(load(name), /^const meta = \{/)
    assert.doesNotMatch(load(name), /Date\.now|Math\.random|new Date\(\)|import\(|^import /m)
  }
})
