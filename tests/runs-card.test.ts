import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, textField, toJson } from "../bay/json.ts";
import { bay } from "./cli-fixture.ts";
import { makeProject, type Project } from "./project-fixture.ts";

const folder = "components/modes/carder";

const reviewSkill = [
  "---",
  "name: review",
  "description: Judges whether the tests assert what each item says.",
  "metadata:",
  "  output: schemas/review-output.json",
  "---",
  "",
  "## Input",
  "",
  "Anything.",
  "",
  "## Output",
  "",
  "A verdict, as schemas/review-output.json.",
  "",
  "## Definition of done",
  "",
  "- [DOD-1] (must) The verdict is one word.",
  "",
  "## Instructions",
  "",
  "1. Read the tests.",
  "",
  "## Rules and constraints",
  "",
  "- Write nothing.",
  "",
].join("\n");

const passScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input) => input);",
  "",
].join("\n");

const anything = `${JSON.stringify({ type: "object" })}\n`;

const carderMode = {
  name: "carder",
  version: "1.0.0",
  description: "Shows a card drawn from what a workflow gives it.",
  actions: {
    review: {
      description: "When a card needs a judgement.",
      input: "schemas/anything.json",
      output: "schemas/review-output.json",
      effects: ["read"],
      run: [{ skill: "skills/review", tier: "deep" }],
    },
    draw: {
      description: "When a workflow draws a card.",
      input: "schemas/anything.json",
      output: "schemas/anything.json",
      effects: ["read"],
      run: [{ script: "scripts/pass.ts" }],
    },
  },
  workflows: ["workflows/computed.yaml", "workflows/judged.yaml", "workflows/forged.yaml"],
};

type CardLine = {
  readonly mark: "computed" | "judged";
  readonly words: string;
  readonly source: { readonly step: string };
};

const computedLines: readonly CardLine[] = [
  { mark: "computed", words: "in scope: 11 of 11 paths", source: { step: "draw" } },
  { mark: "computed", words: "judged by you: whether the sentences read well", source: { step: "draw" } },
];

const judgedLine: CardLine = {
  mark: "judged",
  words: "the tests assert what each item says",
  source: { step: "review" },
};

function drawStep(lines: readonly CardLine[]): object {
  const card = { title: "Merge TR2?", lines, withheld: { merge: "No test ran." } };
  return { id: "draw", action: "draw", input: { card, merge: false } };
}

function cardStep(quotes: readonly string[]): object {
  return {
    id: "card",
    approval: "Merge this slice?",
    show: "$steps.draw.output.card",
    choices: {
      merge: { when: "$steps.draw.output.merge", does: "Merge the slice" },
      keep: { does: "Stop; the slice stays as it is" },
    },
    ...(quotes.length === 0 ? {} : { quotes }),
  };
}

const reviewStep = { id: "review", action: "review" };

const workflows: Readonly<Record<string, object>> = {
  computed: { name: "computed", steps: [drawStep(computedLines), cardStep([])] },
  judged: { name: "judged", steps: [reviewStep, drawStep([computedLines[0], judgedLine]), cardStep(["review"])] },
  forged: {
    name: "forged",
    steps: [reviewStep, drawStep([{ ...judgedLine, mark: "computed" }]), cardStep(["review"])],
  },
};

async function carderProject(): Promise<Project> {
  const project = await makeProject();
  await project.write(`${folder}/mode.yaml`, stringify(carderMode));
  await project.write(`${folder}/schemas/anything.json`, anything);
  await project.write(`${folder}/schemas/review-output.json`, anything);
  await project.write(`${folder}/scripts/pass.ts`, passScript);
  await project.write(`${folder}/skills/review/SKILL.md`, reviewSkill);
  for (const [name, workflow] of Object.entries(workflows)) {
    await project.write(`${folder}/workflows/${name}.yaml`, stringify(workflow));
  }
  return project;
}

type Stopped = {
  readonly runId: string;
  readonly run: Json;
};

function runOf(json: unknown): Json {
  const run = fieldOf(toJson(json), "run");
  assert.ok(run !== undefined, JSON.stringify(json));
  return run;
}

async function stoppedAt(project: Project, workflow: string): Promise<Stopped> {
  const root = ["--project", project.root];
  const called = await bay(["call", "--workflow", `carder:workflows/${workflow}.yaml`, ...root, "--json"]);
  const started = runOf(called.json);
  const runId = textField(started, "id") ?? "";
  const token = textField(fieldOf(started, "task") ?? null, "token");
  if (token === undefined) {
    return { runId, run: started };
  }
  const submitted = await bay(["submit", '{"verdict":"sound"}', "--token", token, ...root, "--json"]);
  return { runId, run: runOf(submitted.json) };
}

async function withCarder(body: (project: Project) => Promise<void>): Promise<void> {
  const project = await carderProject();
  try {
    await body(project);
  } finally {
    await project.remove();
  }
}

test("the JSON form of a card keeps the mark and source on every line, and the skill and tier on a judged one", async () => {
  await withCarder(async (project) => {
    const { runId } = await stoppedAt(project, "judged");
    const shown = await bay(["runs", runId, "--project", project.root, "--json"]);
    const waiting = fieldOf(runOf(shown.json), "waiting") ?? null;
    assert.deepEqual(fieldOf(waiting, "card"), {
      title: "Merge TR2?",
      lines: [
        { mark: "computed", words: "in scope: 11 of 11 paths", source: { step: "draw" } },
        {
          mark: "judged",
          words: "the tests assert what each item says",
          source: { step: "review" },
          skills: [{ mode: "carder", skill: "skills/review", tier: "deep" }],
        },
      ],
      counted: { ran: 0, computed: 1, judged: 1 },
    });
    assert.deepEqual(fieldOf(waiting, "choices"), [
      { name: "merge", status: "withheld", does: "Merge the slice", reason: "No test ran." },
      { name: "keep", status: "offered", does: "Stop; the slice stays as it is" },
    ]);
  });
});
