import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, parseJson, textField } from "../bay/json.ts";
import { makeProject, kit, type Project } from "./project-fixture.ts";
import { partRequestOf } from "./start-part.ts";
import { openModeProject, type ModeProject, type Run, type WorkflowPart } from "./test-toolbox.ts";

const config = {
  bindings: { "greeting-source": "greeter" },
  adapter: "claude-code",
  settings: { writer: { signature: "Yours, the writer" } },
};

const folder = "components/modes/parts";

const workflow = "workflows/parts.yaml";

const eachWorkflow = "workflows/each.yaml";

const reviewWords = "the tests assert what each item says";

const counted = ["items", "first", "second", "draw", "last"];

const manifest = {
  name: "parts",
  version: "1.0.0",
  description: "Counts, asks, reviews and draws a card, so that a test can run a part of its workflow.",
  resources: { files: { read: [".counted/"], write: [".counted/"] } },
  actions: {
    first: {
      description: "When a count is to be started.",
      input: "schemas/any.json",
      output: "schemas/count.json",
      effects: ["read", "write"],
      run: [{ script: "scripts/first.ts" }],
    },
    second: {
      description: "When the count and the choice are to be read back.",
      input: "schemas/any.json",
      output: "schemas/any.json",
      effects: ["read", "write"],
      run: [{ script: "scripts/second.ts" }],
    },
    review: {
      description: "When an agent says what the tests assert.",
      input: "schemas/any.json",
      output: "schemas/review-output.json",
      effects: ["read"],
      run: [{ skill: "skills/review", tier: "deep" }],
    },
    draw: {
      description: "When the review is drawn as a card.",
      input: "schemas/any.json",
      output: "schemas/any.json",
      effects: ["read", "write"],
      run: [{ script: "scripts/draw.ts" }],
    },
    items: {
      description: "When the items to count are listed.",
      input: "schemas/any.json",
      output: "schemas/any.json",
      effects: ["read", "write"],
      run: [{ script: "scripts/items.ts" }],
    },
    last: {
      description: "When the run ends.",
      input: "schemas/any.json",
      output: "schemas/any.json",
      effects: ["read", "write"],
      run: [{ script: "scripts/last.ts" }],
    },
  },
  workflows: [workflow, eachWorkflow],
};

const eachSteps = {
  name: "each",
  trigger: { manual: true },
  steps: [
    { id: "items", action: "items" },
    { id: "each", foreach: "$steps.items.output", steps: [{ id: "one", action: "first", input: { item: "$item" } }] },
    { id: "pause", wait: "5m" },
    { id: "after", action: "last" },
  ],
};

const partsWorkflow = {
  name: "parts",
  trigger: { manual: true },
  steps: [
    { id: "first", action: "first" },
    {
      id: "pick",
      approval: "Go on?",
      show: "$steps.first.output",
      choices: {
        go: { does: "Go on", when: "$steps.first.output.open" },
        halt: { does: "Stop here" },
      },
    },
    {
      id: "second",
      action: "second",
      input: { count: "$steps.first.output.count", choice: "$steps.pick.output.choice" },
    },
    { id: "review", action: "review", input: { count: "$steps.second.output.count" } },
    { id: "draw", action: "draw", input: { review: "$steps.review.output.text" } },
    { id: "card", approval: "Merge?", show: "$steps.draw.output.card", quotes: ["review"] },
    { id: "last", action: "last" },
  ],
};

const countSchema = {
  type: "object",
  additionalProperties: false,
  required: ["count", "open"],
  properties: { count: { type: "integer" }, open: { type: "boolean" } },
};

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string" } },
};

const reviewSkill = [
  "---",
  "name: review",
  "description: Says in one sentence what the tests assert.",
  "metadata:",
  "  output: schemas/review-output.json",
  "---",
  "",
  "## Input",
  "",
  "A count.",
  "",
  "## Output",
  "",
  "One sentence, as schemas/review-output.json.",
  "",
  "## Definition of done",
  "",
  "- [DOD-1] (must) The sentence says what the tests assert.",
  "",
  "## Instructions",
  "",
  "1. Read the tests.",
  "2. Say what they assert.",
  "",
  "## Tools",
  "",
  "- files",
  "",
  "## Resources",
  "",
  "- tests/",
  "",
  "## Rules and constraints",
  "",
  "- Write nothing.",
  "",
].join("\n");

function countingScript(name: string, answer: string): string {
  return [
    'import { defineScript } from "agentbay/sdk";',
    "",
    "export const run = defineScript(async (input, context) => {",
    `  const before = await context.files.read(".counted/${name}.txt");`,
    "  const count = before.ok ? Number(before.value) + 1 : 1;",
    `  await context.files.write(".counted/${name}.txt", String(count));`,
    `  return ${answer};`,
    "});",
    "",
  ].join("\n");
}

const drawAnswer =
  '{ card: { title: "Merge?", lines: [' +
  '{ mark: "computed", words: "drawn by script", source: { step: "draw" } }, ' +
  '{ mark: "judged", words: input.review, source: { step: "review" } }' +
  "] } }";

const scripts: Readonly<Record<string, string>> = {
  first: "{ count: 1, open: input.open === true }",
  second: "{ count: input.count, choice: input.choice }",
  draw: drawAnswer,
  last: "{ ended: true }",
  items: "[{ n: 1 }, { n: 2 }]",
};

function schemaText(schema: Json): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

async function projectWithParts(): Promise<Project> {
  const beside = await makeProject();
  await beside.write(`${folder}/mode.yaml`, stringify(manifest));
  await beside.write(`${folder}/schemas/any.json`, "{}\n");
  await beside.write(`${folder}/schemas/count.json`, schemaText(countSchema));
  await beside.write(`${folder}/schemas/review-output.json`, schemaText(reviewSchema));
  await beside.write(`${folder}/skills/review/SKILL.md`, reviewSkill);
  for (const [name, answer] of Object.entries(scripts)) {
    await beside.write(`${folder}/scripts/${name}.ts`, countingScript(name, answer));
  }
  await beside.write(`${folder}/${workflow}`, stringify(partsWorkflow));
  await beside.write(`${folder}/${eachWorkflow}`, stringify(eachSteps));
  return beside;
}

async function withParts(body: (project: ModeProject) => Promise<void>): Promise<void> {
  const beside = await projectWithParts();
  const project = await openModeProject(config, { project: beside.root });
  try {
    await body(project);
  } finally {
    await project.close();
    await beside.remove();
  }
}

function startPart(project: ModeProject, part: WorkflowPart): Promise<Run> {
  return project.runWorkflowPart("parts", workflow, part);
}

async function countsIn(project: ModeProject): Promise<Readonly<Record<string, number>>> {
  const entries: [string, number][] = [];
  for (const name of counted) {
    const file = join(project.root, ".counted", `${name}.txt`);
    if (existsSync(file)) {
      entries.push([name, Number(await readFile(file, "utf8"))]);
    }
  }
  return Object.fromEntries(entries);
}

function keysOf(run: Run): readonly string[] {
  return run.steps.map((step) => step.key);
}

type Waiting = Extract<Run["state"], { readonly status: "waiting" }>["waiting"];

function waitingOf(run: Run): Waiting {
  if (run.state.status !== "waiting") {
    assert.fail(`expected the run to wait, got ${JSON.stringify(run.state)}`);
  }
  return run.state.waiting;
}

function cardOf(run: Run): Json {
  const waiting = waitingOf(run);
  if (waiting.reason !== "approval" || waiting.card === undefined) {
    assert.fail(`expected the run to wait for an approval with a card, got ${JSON.stringify(waiting)}`);
  }
  return waiting.card;
}

function tokenOf(run: Run): string {
  const waiting = run.state.status === "waiting" ? run.state.waiting : undefined;
  if (waiting?.reason !== "skill" || waiting.task.token === undefined) {
    assert.fail(`expected the run to wait for a skill with a token, got ${JSON.stringify(run.state)}`);
  }
  return waiting.task.token;
}

function stepOutput(run: Run, key: string): Json | undefined {
  return run.steps.find((step) => step.key === key)?.output;
}

const firstGiven = { count: 7, open: true };

const untilQuestion =
  "A test started this run to stop after step second, and it did: no later step starts, " +
  "and resuming the run stops here again.";

test("until stops the run after the step it names, with that step's output recorded and no later step started, and a resume stops there again", async () => {
  await withParts(async (project) => {
    const run = await startPart(project, {
      input: { open: true },
      given: { first: firstGiven, pick: { choice: "go" } },
      until: "second",
    });
    assert.deepEqual(waitingOf(run), { reason: "owner", stepKey: "second", question: untilQuestion });
    assert.deepEqual(keysOf(run), ["first", "pick", "second", "second/0"]);
    assert.deepEqual(stepOutput(run, "second"), { count: 7, choice: "go" });
    assert.deepEqual(await countsIn(project), { second: 1 });
    const resumed = await project.resume(run.id);
    assert.deepEqual(waitingOf(resumed), { reason: "owner", stepKey: "second", question: untilQuestion });
    assert.deepEqual(waitingOf(await project.show(run.id)), {
      reason: "owner",
      stepKey: "second",
      question: untilQuestion,
    });
    assert.deepEqual(keysOf(resumed), ["first", "pick", "second", "second/0"]);
    assert.deepEqual(await countsIn(project), { second: 1 });
    assert.deepEqual(await project.runs(), [{ id: run.id, status: "waiting" }]);
  });
});

test("until with no step given runs every step up to the one it names, and nothing after", async () => {
  await withParts(async (project) => {
    const run = await startPart(project, { input: { open: false }, until: "first" });
    assert.deepEqual(waitingOf(run), {
      reason: "owner",
      stepKey: "first",
      question:
        "A test started this run to stop after step first, and it did: no later step starts, " +
        "and resuming the run stops here again.",
    });
    assert.deepEqual(keysOf(run), ["first", "first/0"]);
    assert.deepEqual(stepOutput(run, "first"), { count: 1, open: false });
    assert.deepEqual(await countsIn(project), { first: 1 });
  });
});

test("given steps are not run: the walk begins at the first step not given, which reads the given outputs", async () => {
  await withParts(async (project) => {
    const run = await startPart(project, {
      input: { open: false },
      given: { first: firstGiven, pick: { choice: "go" } },
    });
    assert.deepEqual(await countsIn(project), { second: 1 });
    assert.deepEqual(stepOutput(run, "second"), { count: 7, choice: "go" });
    assert.deepEqual(stepOutput(run, "pick"), { choice: "go", content: firstGiven });
    assert.equal(waitingOf(run).reason, "skill");
  });
});

test("a given output that breaks its action's output schema refuses the start with the schema's sentence, and no run is made", async () => {
  await withParts(async (project) => {
    const refused = await project.workflowPartRefusal("parts", workflow, {
      given: { first: { count: "seven", open: true } },
    });
    assert.equal(
      refused,
      "The output given for step first does not match the output schema of parts.first: " +
        'output.count must be a whole number, but it is "seven".',
    );
    assert.deepEqual(await project.runs(), []);
    assert.deepEqual(await countsIn(project), {});
  });
});

test("a given approval records the choice it was given, which a later step reads; a choice it withholds, one it lacks, or no choice is refused", async () => {
  await withParts(async (project) => {
    const halted = await startPart(project, {
      input: {},
      given: { first: { count: 2, open: false }, pick: { choice: "halt" } },
      until: "second",
    });
    assert.deepEqual(stepOutput(halted, "second"), { count: 2, choice: "halt" });
    const refusal = (pick: Json): Promise<string> =>
      project.workflowPartRefusal("parts", workflow, { given: { first: { count: 2, open: false }, pick } });
    assert.equal(
      await refusal({ choice: "go" }),
      "Step pick withholds the choice go, by its rule over the steps given before it; give a choice it offers: halt.",
    );
    assert.equal(await refusal({ choice: "fly" }), "Step pick has no choice fly; its choices are go, halt.");
    assert.equal(
      await refusal({ verdict: "approve" }),
      'Step pick has choices; give it as { "choice": "<name>" } with one of go, halt, not {"verdict":"approve"}.',
    );
  });
});

test("an approval with no choices is given as approve, and its quoted step, given too, resolves on the card with no skill named", async () => {
  await withParts(async (project) => {
    const given = {
      first: firstGiven,
      pick: { choice: "go" },
      second: { count: 7, choice: "go" },
      review: { text: reviewWords },
    };
    const run = await startPart(project, { input: {}, given });
    assert.deepEqual(cardOf(run), {
      title: "Merge?",
      lines: [
        { mark: "computed", words: "drawn by script", source: { step: "draw" } },
        { mark: "judged", words: reviewWords, source: { step: "review" }, skills: [] },
      ],
      counted: { ran: 0, computed: 1, judged: 1 },
    });
    assert.deepEqual(await countsIn(project), { draw: 1 });
    const withCard = await startPart(project, {
      input: {},
      given: { ...given, draw: { card: null }, card: { verdict: "approve" } },
      until: "last",
    });
    assert.deepEqual(stepOutput(withCard, "last"), { ended: true });
    assert.equal(
      await project.workflowPartRefusal("parts", workflow, {
        given: { ...given, draw: { card: null }, card: { choice: "go" } },
      }),
      'Step card is an approval with no choices; give it as { "verdict": "approve" }, not {"choice":"go"}.',
    );
  });
});

test("given steps have the keys and the keeping a whole run gives the same steps", async () => {
  await withParts(async (project) => {
    const whole = await project.runWorkflow("parts", workflow, { open: true });
    const pick = waitingOf(whole);
    const hash = pick.reason === "approval" ? pick.hash : "";
    const decision = { stepKey: pick.stepKey, hash, by: "the owner", choice: "go" };
    const reviewed = await project.answer(tokenOf(await project.approve(whole.id, decision)), { text: reviewWords });
    const given = {
      first: { count: 1, open: true },
      pick: { choice: "go" },
      second: { count: 1, choice: "go" },
      review: { text: reviewWords },
    };
    const part = await startPart(project, { input: { open: true }, given });
    const topLevel = (run: Run): readonly Json[] =>
      run.steps
        .filter((step) => !step.key.includes("/"))
        .map((step) => ({ key: step.key, kind: step.kind, status: step.status, kept: step.kept ?? "as-text" }));
    assert.deepEqual(topLevel(part), topLevel(reviewed));
    assert.deepEqual(
      topLevel(part).map((step) => JSON.stringify(step)),
      [
        '{"key":"first","kind":"action","status":"done","kept":"as-text"}',
        '{"key":"pick","kind":"approval","status":"done","kept":"as-text"}',
        '{"key":"second","kind":"action","status":"done","kept":"as-text"}',
        '{"key":"review","kind":"action","status":"done","kept":"as-text"}',
        '{"key":"draw","kind":"action","status":"done","kept":"as-text"}',
        '{"key":"card","kind":"approval","status":"started","kept":"as-text"}',
      ],
    );
  });
});

test("a run started with given steps or until says so: its target names the part, and each given step has an event", async () => {
  await withParts(async (project) => {
    const run = await startPart(project, { input: {}, given: { first: firstGiven }, until: "second" });
    assert.deepEqual(run.target, {
      kind: "workflow",
      mode: "parts",
      name: workflow,
      part: { given: ["first"], until: "second" },
    });
    const given = run.events.filter((event) => event.kind === "step.given").map((event) => event.detail);
    assert.deepEqual(given, [{ stepKey: "first", kind: "action", outputBytes: 23 }]);
    const whole = await project.runWorkflow("parts", workflow, {});
    assert.deepEqual(whole.target, { kind: "workflow", mode: "parts", name: workflow });
  });
});

test("given steps are a run of steps from the first, and until names a later step at the top level", async () => {
  await withParts(async (project) => {
    const refusal = (part: WorkflowPart): Promise<string> => project.workflowPartRefusal("parts", workflow, part);
    assert.equal(
      await refusal({ given: { second: { count: 1, choice: "go" } } }),
      "Step second of the workflow parts is given, but step first before it is not; " +
        "a test gives every step from the first up to the one where the walk is to begin.",
    );
    assert.equal(
      await refusal({ given: { third: {} } }),
      "The workflow parts has no step third at its top level, so it cannot be given; " +
        "its steps are first, pick, second, review, draw, card, last.",
    );
    assert.equal(
      await refusal({ until: "fourth" }),
      "The workflow parts has no step fourth at its top level to stop after; " +
        "its steps are first, pick, second, review, draw, card, last.",
    );
    assert.equal(
      await refusal({ given: { first: firstGiven }, until: "first" }),
      "The run is to stop after step first, which is given, so no step would run; name a later step.",
    );
    assert.deepEqual(await project.runs(), []);
  });
});

test("a given foreach has one output for each item, each checked against the output schema of the action that ends its steps, and a wait cannot be given", async () => {
  await withParts(async (project) => {
    const items = [{ n: 1 }, { n: 2 }];
    const counts = [
      { count: 1, open: true },
      { count: 2, open: false },
    ];
    const run = await project.runWorkflowPart("parts", eachWorkflow, { given: { items, each: counts } });
    assert.deepEqual(waitingOf(run).reason, "time");
    assert.deepEqual(stepOutput(run, "each"), counts);
    assert.deepEqual(await countsIn(project), {});
    const refusal = (given: Readonly<Record<string, Json>>): Promise<string> =>
      project.workflowPartRefusal("parts", eachWorkflow, { given });
    assert.equal(
      await refusal({ items, each: counts.slice(0, 1) }),
      "Step each runs over 2 items, but its given output is a list of 1; give one output for each item.",
    );
    assert.equal(
      await refusal({ items, each: [counts[0] ?? null, { count: 2 }] }),
      "The output given for step each does not match the output schema of parts.first: " +
        "output is missing the required field open.",
    );
    assert.equal(
      await refusal({ items, each: counts, pause: null }),
      "Step pause is a wait, which a test cannot give; give only the steps before it.",
    );
    assert.deepEqual(await project.runs(), [{ id: run.id, status: "waiting" }]);
  });
});

function bayRan(root: string, words: readonly string[]): { readonly status: number | null; readonly stdout: string } {
  const ran = spawnSync(process.execPath, [join(kit, "bay/cli.ts"), ...words], { cwd: root, encoding: "utf8" });
  return { status: ran.status, stdout: ran.stdout };
}

test("the shipped command line knows nothing of given or until, and no kernel file outside the runs feature starts a part", async () => {
  const beside = await projectWithParts();
  try {
    for (const option of ["--given", "--until"]) {
      const ran = bayRan(beside.root, ["call", "--workflow", `parts:${workflow}`, "{}", option, "first", "--json"]);
      assert.equal(ran.status, 2, ran.stdout);
      assert.deepEqual(JSON.parse(ran.stdout), {
        ok: false,
        usage: `The option ${option} is not an option of this command.`,
      });
    }
  } finally {
    await beside.remove();
  }
  const callers: string[] = [];
  for (const entry of await readdir(join(kit, "bay"), { recursive: true, withFileTypes: true })) {
    const path = join(entry.parentPath, entry.name);
    if (entry.isFile() && path.endsWith(".ts") && !path.startsWith(join(kit, "bay/runs/"))) {
      const text = await readFile(path, "utf8");
      if (text.includes("startPart") || text.includes("startWorkflowPart")) {
        callers.push(path.slice(kit.length + 1));
      }
    }
  }
  assert.deepEqual(callers, []);
  const schema = await readFile(join(kit, "schemas/workflow.schema.json"), "utf8");
  assert.deepEqual(
    ['"given"', '"until"'].filter((field) => schema.includes(field)),
    [],
  );
});

function partStarted(
  root: string,
  words: readonly string[],
): { readonly status: number | null; readonly answer: Json } {
  const ran = spawnSync(process.execPath, [join(kit, "tests/start-part.ts"), ...words], {
    cwd: root,
    encoding: "utf8",
  });
  return { status: ran.status, answer: parseJson(ran.stdout) };
}

test("a test that drives bay in its own process starts a part with tests/start-part.ts, and the shipped command line shows the run and its part", async () => {
  const beside = await projectWithParts();
  try {
    const part = JSON.stringify({ given: { first: firstGiven, pick: { choice: "go" } }, until: "second" });
    const started = partStarted(beside.root, [`parts:${workflow}`, "{}", part]);
    assert.equal(started.status, 0, JSON.stringify(started.answer));
    const run = fieldOf(started.answer, "run") ?? null;
    const id = textField(run, "id") ?? "";
    assert.equal(textField(run, "status"), "waiting");
    const report = fieldOf(parseJson(bayRan(beside.root, ["runs", id, "--json"]).stdout), "run") ?? null;
    assert.deepEqual(fieldOf(report, "target"), {
      kind: "workflow",
      mode: "parts",
      name: workflow,
      part: { given: ["first", "pick"], until: "second" },
    });
    assert.deepEqual(fieldOf(report, "waiting"), { reason: "owner", stepKey: "second", question: untilQuestion });
    const text = bayRan(beside.root, ["runs", id]).stdout;
    assert.ok(text.includes(`waiting for owner at second`), text);
  } finally {
    await beside.remove();
  }
});

test("tests/start-part.ts refuses a project outside the temporary folder, such as the kit, and a part that breaks a schema", async () => {
  const outside = partStarted(kit, [`forge:workflows/rounds.yaml`, "{}", "{}"]);
  assert.equal(outside.status, 1);
  assert.deepEqual(outside.answer, {
    ok: false,
    problems: [
      {
        message:
          `tests/start-part.ts starts a part of a workflow only in a test's project, under ${tmpdir()}; ` +
          `${kit} is not under it.`,
        fix: "node tests/start-part.ts <mode>:<path> '<trigger json>' '<part json>'",
      },
    ],
  });
  const beside = await projectWithParts();
  try {
    const broken = partStarted(beside.root, [
      `parts:${workflow}`,
      "{}",
      JSON.stringify({ given: { first: { count: 1 } } }),
    ]);
    assert.equal(broken.status, 1);
    assert.deepEqual(broken.answer, {
      ok: false,
      problems: [
        {
          message:
            "The output given for step first does not match the output schema of parts.first: " +
            "output is missing the required field open.",
          fix: "",
        },
      ],
    });
  } finally {
    await beside.remove();
  }
});

test("tests/start-part.ts reads the workflow as <mode>:<path>, the trigger and the part as JSON, and refuses anything else with its usage", () => {
  const fix = "node tests/start-part.ts <mode>:<path> '<trigger json>' '<part json>'";
  assert.deepEqual(
    partRequestOf(["forge:workflows/rounds.yaml", '{"a":1}', '{"given":{"slice":{}},"until":"start"}']),
    {
      ok: true,
      value: { mode: "forge", path: "workflows/rounds.yaml", input: { a: 1 }, given: { slice: {} }, until: "start" },
    },
  );
  assert.deepEqual(partRequestOf(["rounds"]), {
    ok: false,
    problems: [{ file: "", path: "", message: "The workflow is named as <mode>:<path>, not rounds.", fix }],
  });
  assert.deepEqual(partRequestOf(["forge:workflows/rounds.yaml", "{"]), {
    ok: false,
    problems: [{ file: "", path: "", message: "The trigger is not JSON: {", fix }],
  });
  assert.deepEqual(partRequestOf(["forge:workflows/rounds.yaml", "{}", '{"given":[1]}']), {
    ok: false,
    problems: [{ file: "", path: "", message: "The part's given is not a mapping of step ids to outputs.", fix }],
  });
});
