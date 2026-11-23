export const meta = {
  name: 'plan',
  description: 'Turn a requirements file into reviewed build slices and save the plan for /dev:build',
  whenToUse: 'Before /dev:build, with args {requirements: path, repo?: path}',
  phases: [
    { title: 'Plan', detail: 'lead agent splits the requirements into slices' },
    { title: 'Save', detail: 'write the plan to .agentbay/dev/plan.json' },
  ],
}

const STRINGS = { type: 'array', items: { type: 'string' } }

const PLAN_SCHEMA = {
  type: 'object',
  required: ['slices', 'interfaces', 'open_questions'],
  properties: {
    slices: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        required: ['id', 'title', 'done', 'files', 'depends_on'],
        properties: {
          id: { type: 'string', pattern: '^S[0-9]+$' },
          title: { type: 'string' },
          done: { type: 'string' },
          files: STRINGS,
          depends_on: STRINGS,
        },
      },
    },
    interfaces: STRINGS,
    open_questions: STRINGS,
  },
}

function leadPrompt(requirements, repo) {
  return [
    `Read the requirements in ${requirements} and the code in ${repo}.`,
    'Split the work into slices a builder can finish and a reviewer can judge on their own.',
    'Give each slice an id S1, S2, ..., a title of a few words, a definition of done that a test can check,',
    'the files it may touch, and the ids it depends on.',
    'Slices that do not depend on each other must not share files.',
    'List the interfaces slices share, and every question the requirements leave open instead of guessing.',
  ].join('\n')
}

function savePrompt(path, plan) {
  return [
    `Write the JSON below to ${path}, pretty-printed with two spaces, creating parent folders.`,
    'Change nothing in it and write no other file. Reply with the path.',
    '',
    JSON.stringify(plan),
  ].join('\n')
}

if (!args?.requirements) {
  return { error: 'Pass args.requirements: the path to a requirements file.' }
}

const repo = args.repo ?? '.'
const path = `${repo}/.agentbay/dev/plan.json`

phase('Plan')
const plan = await agent(leadPrompt(args.requirements, repo), {
  agentType: 'dev:lead',
  label: 'lead',
  schema: PLAN_SCHEMA,
})
if (!plan) {
  return { error: 'The lead agent stopped before returning a plan.' }
}

phase('Save')
const saved = await agent(savePrompt(path, { repo, ...plan }), { label: 'save plan', effort: 'low' })

return {
  plan: saved ? path : null,
  slices: plan.slices.map(slice => `${slice.id}: ${slice.title}`),
  interfaces: plan.interfaces,
  open_questions: plan.open_questions,
}
