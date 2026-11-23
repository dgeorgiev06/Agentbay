export const meta = {
  name: 'plan',
  description: 'Turn a requirements file into reviewed build slices and return the plan for approval',
  whenToUse: 'Before /dev:build, with args {requirements: path, repo?: path}',
  phases: [{ title: 'Plan', detail: 'lead agent splits the requirements into slices' }],
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
    'Give each slice an id S1, S2, ..., a title of a few words,',
    'a definition of done that a test can check, the files it may touch, and the ids it depends on.',
    'Slices that do not depend on each other must not share files.',
    'List the interfaces slices share, and every question the requirements leave open instead of guessing.',
  ].join('\n')
}

if (!args?.requirements) {
  return { error: 'Pass args.requirements: the path to a requirements file.' }
}

const repo = args.repo ?? '.'

phase('Plan')
const lead = await agent(leadPrompt(args.requirements, repo), {
  agentType: 'dev:lead',
  label: 'lead',
  schema: PLAN_SCHEMA,
})
if (!lead) {
  return { error: 'The lead agent stopped before returning a plan.' }
}

const { open_questions, ...slicesAndInterfaces } = lead
return { plan: { repo, ...slicesAndInterfaces }, open_questions }
