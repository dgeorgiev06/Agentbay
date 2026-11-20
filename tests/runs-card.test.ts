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
  workflows: ["workflows/computed.yaml", "workflows/judged.yaml", "workflows/forged.yaml", "workflows/items.yaml"],
};

type CardLine = {
  readonly mark: "computed" | "judged";
  readonly words: string;
  readonly source: { readonly step: string; readonly item?: number };
};

const inScope: CardLine = { mark: "computed", words: "in scope: 11 of 11 paths", source: { step: "draw" } };

const computedLines: readonly CardLine[] = [
  inScope,
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
  judged: { name: "judged", steps: [reviewStep, drawStep([inScope, judgedLine]), cardStep(["review"])] },
  forged: {
    name: "forged",
    steps: [reviewStep, drawStep([{ ...judgedLine, mark: "computed" }]), cardStep(["review"])],
  },
  items: {
    name: "items",
    steps: [
      { id: "list", action: "draw", input: { items: [{ slice: "first" }, { slice: "second" }] } },
      { id: "each", foreach: "$steps.list.output.items", steps: [reviewStep] },
      drawStep([
        { ...judgedLine, source: { step: "review", item: 0 } },
        { ...judgedLine, words: "and each case is named", source: { step: "review", item: 0 } },
        { ...judgedLine, words: "the second holds too", source: { step: "review", item: 1 } },
      ]),
      cardStep(["review"]),
    ],
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
  let run = started;
  for (;;) {
    const token = textField(fieldOf(run, "task") ?? null, "token");
    if (token === undefined) {
      return { runId, run };
    }
    await bay(["submit", '{"verdict":"sound"}', "--token", token, ...root, "--json"]);
    run = runOf((await bay(["runs", runId, "--new-token", ...root, "--json"])).json);
  }
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

async function printedCard(project: Project, workflow: string): Promise<readonly string[]> {
  const { runId } = await stoppedAt(project, workflow);
  const shown = await bay(["runs", runId, "--project", project.root]);
  const rows = shown.output.split("\n");
  const decide = rows.findIndex((row) => row.startsWith("decide with: "));
  return rows.slice(1, decide);
}

function hashRow(rows: readonly string[]): string {
  return rows.find((row) => row.startsWith("hash ")) ?? "";
}

test("a card of computed lines prints them with no mark and says once, at their foot, that script worked them out", async () => {
  await withCarder(async (project) => {
    const rows = await printedCard(project, "computed");
    assert.deepEqual(rows, [
      "Merge TR2?",
      "  in scope: 11 of 11 paths",
      "  judged by you: whether the sentences read",
      "    well",
      "All lines worked out by script.",
      "You can:",
      "  keep  Stop; the slice stays as it is",
      "Not available:",
      "  merge  Merge the slice",
      "         why: No test ran.",
      "checked: 0 ran, 2 computed, 0 judged",
      hashRow(rows),
    ]);
    assert.match(hashRow(rows), /^hash [0-9a-f]{12}$/);
    assert.deepEqual(
      rows.filter((row) => Array.from(row).length > 44),
      [],
    );
  });
});

test("a judged line keeps its mark at the start of each row, with its skill and tier on a row of its own", async () => {
  await withCarder(async (project) => {
    const rows = await printedCard(project, "judged");
    assert.deepEqual(rows, [
      "Merge TR2?",
      "  in scope: 11 of 11 paths",
      "judged   the tests assert what each item",
      "judged     says",
      "judged    by carder skills/review, tier deep",
      "Unmarked lines were worked out by script.",
      "You can:",
      "  keep  Stop; the slice stays as it is",
      "Not available:",
      "  merge  Merge the slice",
      "         why: No test ran.",
      "checked: 0 ran, 1 computed, 1 judged",
      hashRow(rows),
    ]);
    assert.equal(Array.from(rows[4] ?? "").length, 44);
    assert.deepEqual(
      rows.filter((row) => Array.from(row).length > 44),
      [],
    );
  });
});

test("a judged line from a step in an item names its skill and its item on the row under it", async () => {
  await withCarder(async (project) => {
    const rows = await printedCard(project, "items");
    assert.deepEqual(rows, [
      "Merge TR2?",
      "judged   the tests assert what each item",
      "judged     says",
      "judged   and each case is named",
      "judged    by carder skills/review, tier",
      "judged      deep, in item 0 of each",
      "judged   the second holds too",
      "judged    by carder skills/review, tier",
      "judged      deep, in item 1 of each",
      "You can:",
      "  keep  Stop; the slice stays as it is",
      "Not available:",
      "  merge  Merge the slice",
      "         why: No test ran.",
      "checked: 0 ran, 0 computed, 3 judged",
      hashRow(rows),
    ]);
  });
});

test("the kernel still refuses a line marked computed whose source is a step that ran a skill", async () => {
  await withCarder(async (project) => {
    const { run } = await stoppedAt(project, "forged");
    assert.equal(textField(run, "status"), "failed");
    assert.equal(
      textField(run, "reason"),
      "Step card cannot show its card: line 1 is marked computed but cites step review, " +
        "which ran the skill skills/review of mode carder; a computed line cites a step that ran no skill.",
    );
  });
});
