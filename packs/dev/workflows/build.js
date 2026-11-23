export const meta = {
  name: 'build',
  description: 'Build an approved /dev:plan slice by slice: hidden tests, builder, test run and review, at most two rounds each',
  whenToUse: 'After the user approves a plan from /dev:plan, with args {plan: the plan object, parallel?: 2}',
  phases: [{ title: 'Build', detail: 'tests, build, run and review per slice in dependency waves' }],
}

const MAX_ROUNDS = 2
const STRINGS = { type: 'array', items: { type: 'string' } }
const SLICE_TEXT_FIELDS = ['id', 'title', 'done']
const SLICE_LIST_FIELDS = ['files', 'depends_on']

const TESTS_SCHEMA = {
  type: 'object',
  required: ['files', 'test_command'],
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'content'],
        properties: { path: { type: 'string' }, content: { type: 'string' } },
      },
    },
    test_command: { type: 'string' },
  },
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

function planError(plan) {
  if (!Array.isArray(plan?.slices) || plan.slices.length === 0) {
    return 'Pass args.plan: the plan object from /dev:plan, with a slices array.'
  }
  const broken = plan.slices.find(slice =>
    SLICE_TEXT_FIELDS.some(field => typeof slice?.[field] !== 'string') ||
    SLICE_LIST_FIELDS.some(field => !Array.isArray(slice[field])))
  if (broken) {
    return `Every plan slice needs ${[...SLICE_TEXT_FIELDS, ...SLICE_LIST_FIELDS].join(', ')}.`
  }
  return null
}

function parallelError(parallel) {
  if (parallel === undefined || (Number.isInteger(parallel) && parallel >= 1)) {
    return null
  }
  return 'args.parallel must be a positive whole number.'
}

function sliceText(slice) {
  return [
    `Slice ${slice.id}: ${slice.title}`,
    `Done means: ${slice.done}`,
    `Files it may touch: ${slice.files.join(', ')}`,
  ].join('\n')
}

function interfacesText(plan) {
  return `Repository: ${plan.repo}. Shared interfaces: ${plan.interfaces.join('; ') || 'none'}.`
}

function testWriterPrompt(plan, slice) {
  return [
    sliceText(slice),
    interfacesText(plan),
    'Write tests that check the definition of done. Do not write any file yourself.',
    'Return each test file as {path, content}, with the path relative to a test root, and import',
    'the repository code by absolute path.',
    'Return the command that runs exactly these tests from the test root.',
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
  const names = others.map(other => `${other.id} ${other.title}`)
  return [
    sliceText(slice),
    interfacesText(plan),
    `Other slices, built by others: ${names.join('; ') || 'none'}.`,
    feedback ? feedbackText(feedback) : 'Implement the slice and its own tests.',
  ].join('\n')
}

function runPrompt(slice, tests) {
  return [
    `Test root: $TMPDIR/agentbay-dev/${slice.id}/`,
    `Command: ${tests.test_command}`,
    `Files: ${JSON.stringify(tests.files)}`,
  ].join('\n')
}

function reviewerPrompt(plan, slice) {
  const others = plan.slices.filter(other => other.id !== slice.id)
  const otherFiles = others.flatMap(other => other.files)
  return [
    sliceText(slice),
    `Repository: ${plan.repo}. Review the working-tree changes to the slice's files:`,
    `git diff -- ${slice.files.join(' ')}.`,
    'Run an unscoped git status --porcelain. Raise a must finding for every changed path',
    `outside the slice's files, except these files of other slices: ${otherFiles.join(', ') || 'none'}.`,
    'Judge the changes against the definition of done and the merge rules.',
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
  const failure = { name: 'test run', message: 'The test runner stopped.' }
  return run ?? { passed: false, failures: [failure] }
}

async function runPool(items, size, work) {
  const results = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await work(items[index])
    }
  }
  const workers = Array.from({ length: Math.min(size, items.length) }, () => worker)
  await parallel(workers)
  return results
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
    const run = runFailed(await agent(runPrompt(slice, tests), {
      ...opts(`run ${round}`),
      agentType: 'dev:runner',
      schema: RUN_SCHEMA,
    }))
    if (!run.passed) {
      feedback = { failures: run.failures, must: [] }
      last = { rounds: round, failures: run.failures, reason: 'Hidden tests still fail.' }
      continue
    }
    const review = await agent(reviewerPrompt(plan, slice), {
      ...opts(`review ${round}`),
      agentType: 'dev:reviewer',
      schema: REVIEW_SCHEMA,
    })
    if (review === null) {
      return outcome(slice, 'needs-decision', { rounds: round, reason: 'The reviewer stopped.' })
    }
    if (review.verdict === 'pass') {
      return outcome(slice, 'pass', { rounds: round, should: review.should })
    }
    feedback = { failures: [], must: review.must }
    const reason = 'The reviewer asks for fixes.'
    last = { rounds: round, must: review.must, should: review.should, reason }
  }
  return outcome(slice, 'needs-decision', last)
}

const argsError = planError(args?.plan) ?? parallelError(args?.parallel)
if (argsError) {
  return { error: argsError }
}

const cap = args.parallel ?? 2
const plan = { repo: '.', interfaces: [], ...args.plan }

phase('Build')
const results = []
let waiting = plan.slices
while (waiting.length > 0) {
  const passedResults = results.filter(result => result.status === 'pass')
  const passed = new Set(passedResults.map(result => result.id))
  const ready = waiting.filter(slice => slice.depends_on.every(id => passed.has(id)))
  if (ready.length === 0) {
    break
  }
  const built = await runPool(ready, cap, slice => buildSlice(plan, slice))
  ready.forEach((slice, index) => {
    const stopped = outcome(slice, 'needs-decision', { reason: 'The slice run stopped.' })
    results.push(built[index] ?? stopped)
  })
  waiting = waiting.filter(slice => !ready.includes(slice))
}
for (const slice of waiting) {
  const reason = `Waits on ${slice.depends_on.join(', ')}, which did not pass.`
  results.push(outcome(slice, 'needs-decision', { reason }))
}

log(results.map(result => `${result.id} ${result.title}: ${result.status}`).join('\n'))
return { slices: results }
