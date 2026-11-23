export const meta = {
  name: 'build',
  description: 'Build an approved /dev:plan slice by slice: hidden tests, builder, test run and review, at most two rounds each',
  whenToUse: 'After the user approves a plan from /dev:plan, with args {plan: path, parallel?: 2}',
  phases: [
    { title: 'Load', detail: 'read the approved plan' },
    { title: 'Build', detail: 'tests, build, run and review per slice in dependency waves' },
  ],
}

const MAX_ROUNDS = 2
const STRINGS = { type: 'array', items: { type: 'string' } }

const PLAN_SCHEMA = {
  type: 'object',
  required: ['repo', 'slices', 'interfaces'],
  properties: {
    repo: { type: 'string' },
    slices: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'title', 'done', 'files', 'depends_on'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          done: { type: 'string' },
          files: STRINGS,
          depends_on: STRINGS,
        },
      },
    },
    interfaces: STRINGS,
  },
}

const TESTS_SCHEMA = {
  type: 'object',
  required: ['test_command', 'files'],
  properties: { test_command: { type: 'string' }, files: STRINGS },
}

const RUN_SCHEMA = {
  type: 'object',
  required: ['passed', 'failures'],
  properties: {
    passed: { type: 'boolean' },
    failures: {
      type: 'array',
      items: {
        type: 'object',
        required: ['name', 'message'],
        properties: { name: { type: 'string' }, message: { type: 'string' } },
      },
    },
  },
}

const FINDINGS = {
  type: 'array',
  items: {
    type: 'object',
    required: ['id', 'rule', 'file', 'what'],
    properties: {
      id: { type: 'string' },
      rule: { type: 'string' },
      file: { type: 'string' },
      what: { type: 'string' },
    },
  },
}

const REVIEW_SCHEMA = {
  type: 'object',
  required: ['verdict', 'must', 'should'],
  properties: { verdict: { enum: ['pass', 'fix'] }, must: FINDINGS, should: FINDINGS },
}

function chunks(items, size) {
  const groups = []
  for (let start = 0; start < items.length; start += size) {
    groups.push(items.slice(start, start + size))
  }
  return groups
}

function hiddenDir(repo, slice) {
  return `${repo}/.agentbay/dev/hidden-tests/${slice.id}`
}

function sliceText(slice) {
  return [
    `Slice ${slice.id}: ${slice.title}`,
    `Done means: ${slice.done}`,
    `Files it may touch: ${slice.files.join(', ')}`,
  ].join('\n')
}

function testWriterPrompt(plan, slice) {
  return [
    sliceText(slice),
    `Repository: ${plan.repo}. Shared interfaces: ${plan.interfaces.join('; ') || 'none'}.`,
    `Write tests that check the definition of done, only under ${hiddenDir(plan.repo, slice)}.`,
    'Return the command that runs exactly these tests from the repository root, and the files you wrote.',
  ].join('\n')
}

function feedbackText(feedback) {
  if (feedback.failures.length > 0) {
    const lines = feedback.failures.map(failure => `- ${failure.name}: ${failure.message}`)
    return ['The hidden tests failed. Failing tests:', ...lines].join('\n')
  }
  const lines = feedback.must.map(item => `- ${item.id} [${item.rule}] ${item.file}: ${item.what}`)
  return ['The reviewer requires these fixes:', ...lines].join('\n')
}

function builderPrompt(plan, slice, feedback) {
  const others = plan.slices.filter(other => other.id !== slice.id)
  return [
    sliceText(slice),
    `Repository: ${plan.repo}. Shared interfaces: ${plan.interfaces.join('; ') || 'none'}.`,
    `Other slices, built by others: ${others.map(other => `${other.id} ${other.title}`).join('; ') || 'none'}.`,
    `Never open, list or search ${plan.repo}/.agentbay/dev/hidden-tests.`,
    feedback ? feedbackText(feedback) : 'Implement the slice and its own tests.',
  ].join('\n')
}

function runPrompt(plan, tests) {
  return [
    `From ${plan.repo}, run exactly: ${tests.test_command}`,
    'Do not edit any file. Report whether every test passed, and each failing test by name with its message.',
  ].join('\n')
}

function reviewerPrompt(plan, slice) {
  return [
    sliceText(slice),
    `Repository: ${plan.repo}. Review the working-tree changes to the slice's files:`,
    `git diff -- ${slice.files.join(' ')} and git status --porcelain -- ${slice.files.join(' ')}.`,
    'Judge them against the definition of done and the merge rules.',
  ].join('\n')
}

function outcome(slice, status, details) {
  return {
    id: slice.id,
    title: slice.title,
    status,
    rounds: details.rounds ?? 0,
    reason: details.reason ?? null,
    failures: details.failures ?? [],
    must: details.must ?? [],
    should: details.should ?? [],
  }
}

function runFailed(run) {
  return run ?? { passed: false, failures: [{ name: 'test run', message: 'The test runner stopped.' }] }
}

function reviewFailed(review) {
  return review ?? { verdict: 'fix', must: [], should: [] }
}

async function buildSlice(plan, slice) {
  const opts = step => ({ label: `${slice.id} ${step}`, phase: 'Build' })
  const tests = await agent(testWriterPrompt(plan, slice), {
    ...opts('tests'),
    agentType: 'dev:test-writer',
    schema: TESTS_SCHEMA,
  })
  if (!tests) {
    return outcome(slice, 'needs-decision', { reason: 'The test writer stopped.' })
  }
  let feedback = null
  let last = {}
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const built = await agent(builderPrompt(plan, slice, feedback), {
      ...opts(`build ${round}`),
      agentType: 'dev:builder',
    })
    if (built === null) {
      const reason = 'The builder stopped.'
      return outcome(slice, 'needs-decision', { ...last, rounds: round, reason })
    }
    const run = runFailed(await agent(runPrompt(plan, tests), {
      ...opts(`run ${round}`),
      agentType: 'dev:test-writer',
      effort: 'low',
      schema: RUN_SCHEMA,
    }))
    if (!run.passed) {
      feedback = { failures: run.failures, must: [] }
      last = { rounds: round, failures: run.failures, reason: 'Hidden tests still fail.' }
      continue
    }
    const review = reviewFailed(await agent(reviewerPrompt(plan, slice), {
      ...opts(`review ${round}`),
      agentType: 'dev:reviewer',
      schema: REVIEW_SCHEMA,
    }))
    if (review.verdict === 'pass') {
      return outcome(slice, 'pass', { rounds: round, should: review.should })
    }
    feedback = { failures: [], must: review.must }
    last = { rounds: round, must: review.must, should: review.should, reason: 'The reviewer asks for fixes.' }
  }
  return outcome(slice, 'needs-decision', last)
}

if (!args?.plan) {
  return { error: 'Pass args.plan: the path to a plan written by /dev:plan.' }
}

const cap = args.parallel ?? 2

phase('Load')
const plan = await agent(`Read ${args.plan} and return its JSON exactly as written. Edit nothing.`, {
  label: 'load plan',
  effort: 'low',
  schema: PLAN_SCHEMA,
})
if (!plan) {
  return { error: `Could not read the plan at ${args.plan}.` }
}

phase('Build')
const results = []
let waiting = plan.slices
while (waiting.length > 0) {
  const passed = new Set(results.filter(result => result.status === 'pass').map(result => result.id))
  const ready = waiting.filter(slice => slice.depends_on.every(id => passed.has(id)))
  if (ready.length === 0) {
    break
  }
  for (const group of chunks(ready, cap)) {
    const built = await parallel(group.map(slice => () => buildSlice(plan, slice)))
    group.forEach((slice, index) => {
      results.push(built[index] ?? outcome(slice, 'needs-decision', { reason: 'The slice run stopped.' }))
    })
  }
  waiting = waiting.filter(slice => !ready.includes(slice))
}
for (const slice of waiting) {
  const reason = `Waits on ${slice.depends_on.join(', ')}, which did not pass.`
  results.push(outcome(slice, 'needs-decision', { reason }))
}

log(results.map(result => `${result.id} ${result.title}: ${result.status}`).join('\n'))
return { slices: results }
