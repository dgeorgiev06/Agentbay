import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { hashOf } from "../bay/json.ts";
import { makeProject, type Project } from "./project-fixture.ts";
import { openModeProject, type ModeProject, type Run } from "./test-toolbox.ts";

const config = {
  bindings: { "greeting-source": "greeter" },
  adapter: "claude-code",
  settings: { writer: { signature: "Yours, the writer" } },
};

const folder = "components/modes/chooser";

const reviewWords = "the tests assert what each item says";

const reasons = { merge: "1 must item is inconclusive.", sendBack: "Round 2 is the last round." };

const chooserManifest = {
  name: "chooser",
  version: "1.0.0",
  description: "Reviews a slice, draws a card of it, and carries out the choice the owner takes.",
  actions: {
    review: {
      description: "When a slice needs an agent's review.",
      input: "schemas/any.json",
      output: "schemas/review-output.json",
      effects: ["read"],
      run: [{ skill: "skills/review", tier: "deep" }],
    },
    draw: {
      description: "When a review is drawn as a card with the rules of its choices.",
      input: "schemas/any.json",
      output: "schemas/any.json",
      effects: ["read"],
      run: [{ script: "scripts/draw.ts" }],
    },
    "carry-out": {
      description: "When the choice the owner took is carried out.",
      input: "schemas/any.json",
      output: "schemas/any.json",
      effects: ["read"],
      run: [{ script: "scripts/carry-out.ts" }],
    },
  },
  workflows: ["workflows/merge.yaml"],
};

const mergeWorkflow = {
  name: "merge",
  trigger: { manual: true },
  steps: [
    { id: "review", action: "review" },
    { id: "draw", action: "draw", input: { given: "$trigger", review: "$steps.review.output.text" } },
    {
      id: "card",
      approval: "Merge this slice?",
      show: "$steps.draw.output.card",
      quotes: ["review"],
      choices: {
        merge: { when: "$steps.draw.output.merge", does: "Merge into the integration branch" },
        "send-back": { when: "$steps.draw.output.sendBack", does: "Round 2, a fresh builder" },
        keep: { does: "Stop; the branches stay" },
        discard: { does: "Stop; the worktree goes" },
      },
    },
    { id: "after", action: "carry-out", input: { choice: "$steps.card.output.choice" } },
  ],
};

const reviewSkill = [
  "---",
  "name: review",
  "description: Reviews a slice and says in one sentence what its tests assert.",
  "metadata:",
  "  output: schemas/review-output.json",
  "---",
  "",
  "## Input",
  "",
  "Nothing.",
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

const drawScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "function fieldsOf(value) {",
  '  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};',
  "}",
  "",
  "export const run = defineScript(async (input) => {",
  "  const given = fieldsOf(fieldsOf(input).given);",
  "  const merge = given.merge === true;",
  "  const sendBack = given.sendBack === true;",
  "  const withheld = {",
  `    ...(merge ? {} : { merge: ${JSON.stringify(reasons.merge)} }),`,
  `    ...(sendBack ? {} : { "send-back": ${JSON.stringify(reasons.sendBack)} }),`,
  "  };",
  "  const lines = [",
  '    { mark: "computed", words: "in scope: 11 of 11 paths", source: { step: "draw" } },',
  '    { mark: "judged", words: fieldsOf(input).review, source: { step: "review" } },',
  "  ];",
  '  const card = { title: "Merge TT1?", lines, withheld };',
  "  return { card, merge, sendBack };",
  "});",
  "",
].join("\n");

const carryOutScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input) => ({ taken: input.choice }));",
  "",
].join("\n");

function schemaText(schema: Json): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

async function projectWithChooser(): Promise<Project> {
  const beside = await makeProject();
  const reviewOutput = {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string" } },
  };
  await beside.write(`${folder}/mode.yaml`, stringify(chooserManifest));
  await beside.write(`${folder}/schemas/any.json`, "{}\n");
  await beside.write(`${folder}/schemas/review-output.json`, schemaText(reviewOutput));
  await beside.write(`${folder}/skills/review/SKILL.md`, reviewSkill);
  await beside.write(`${folder}/scripts/draw.ts`, drawScript);
  await beside.write(`${folder}/scripts/carry-out.ts`, carryOutScript);
  await beside.write(`${folder}/workflows/merge.yaml`, stringify(mergeWorkflow));
  return beside;
}

async function withChooser(body: (project: ModeProject) => Promise<void>): Promise<void> {
  const beside = await projectWithChooser();
  const project = await openModeProject(config, { project: beside.root });
  try {
    await body(project);
  } finally {
    await project.close();
    await beside.remove();
  }
}

type Rules = { readonly merge: boolean; readonly sendBack: boolean };

async function atCard(project: ModeProject, rules: Rules): Promise<Run> {
  const started = await project.runWorkflow("chooser", "workflows/merge.yaml", rules);
  if (started.state.status !== "waiting" || started.state.waiting.reason !== "skill") {
    assert.fail(`expected the run to wait for the review, got ${JSON.stringify(started.state)}`);
  }
  const token = started.state.waiting.task.token;
  assert.ok(token !== undefined, "the review's task carries no token");
  return project.answer(token, { text: reviewWords });
}

function waitingOf(run: Run): unknown {
  if (run.state.status !== "waiting") {
    assert.fail(`expected the run to wait, got ${JSON.stringify(run.state)}`);
  }
  return run.state.waiting;
}

function contentOf(withheld: Readonly<Record<string, string>>): Json {
  return {
    title: "Merge TT1?",
    lines: [
      { mark: "computed", words: "in scope: 11 of 11 paths", source: { step: "draw" } },
      { mark: "judged", words: reviewWords, source: { step: "review" } },
    ],
    withheld,
  };
}

const mergeWithheld = contentOf({ merge: reasons.merge });

const card = {
  title: "Merge TT1?",
  lines: [
    { mark: "computed", words: "in scope: 11 of 11 paths", source: { step: "draw" } },
    {
      mark: "judged",
      words: reviewWords,
      source: { step: "review" },
      skills: [{ mode: "chooser", skill: "skills/review", tier: "deep" }],
    },
  ],
  counted: { ran: 0, computed: 1, judged: 1 },
};

const waitingWithMergeWithheld = {
  reason: "approval",
  stepKey: "card",
  question: "Merge this slice?",
  hash: hashOf(mergeWithheld),
  content: mergeWithheld,
  choices: [
    { name: "merge", status: "withheld", does: "Merge into the integration branch", reason: reasons.merge },
    { name: "send-back", status: "offered", does: "Round 2, a fresh builder" },
    { name: "keep", status: "offered", does: "Stop; the branches stay" },
    { name: "discard", status: "offered", does: "Stop; the worktree goes" },
  ],
  card,
};

const by = "the owner";

test("a waiting approval shows its question, its hash, each choice with what it does and why one is withheld, and its card", async () => {
  await withChooser(async (project) => {
    const run = await atCard(project, { merge: false, sendBack: true });
    assert.deepEqual(waitingOf(run), waitingWithMergeWithheld);
    assert.deepEqual(waitingOf(await project.show(run.id)), waitingWithMergeWithheld);
  });
});

test("each choice offered is taken by its name and read by a later step", async () => {
  await withChooser(async (project) => {
    const everyOffered = contentOf({});
    for (const choice of ["merge", "send-back", "keep", "discard"]) {
      const run = await atCard(project, { merge: true, sendBack: true });
      const shown = waitingOf(run);
      assert.deepEqual(shown, {
        reason: "approval",
        stepKey: "card",
        question: "Merge this slice?",
        hash: hashOf(everyOffered),
        content: everyOffered,
        choices: [
          { name: "merge", status: "offered", does: "Merge into the integration branch" },
          { name: "send-back", status: "offered", does: "Round 2, a fresh builder" },
          { name: "keep", status: "offered", does: "Stop; the branches stay" },
          { name: "discard", status: "offered", does: "Stop; the worktree goes" },
        ],
        card,
      });
      const decided = await project.approve(run.id, { stepKey: "card", hash: hashOf(everyOffered), choice, by });
      assert.deepEqual(decided.state, { status: "done", output: { taken: choice } });
    }
  });
});

test("a withheld choice is refused with its reason and an unknown one with the names offered, and the approval still waits as it did", async () => {
  await withChooser(async (project) => {
    const run = await atCard(project, { merge: false, sendBack: true });
    const decision = { stepKey: "card", hash: hashOf(mergeWithheld), by };
    assert.equal(
      await project.approveRefusal(run.id, { ...decision, choice: "merge" }),
      "The choice merge of step card is withheld: 1 must item is inconclusive.",
    );
    await assert.rejects(project.approve(run.id, { ...decision, choice: "merge" }), /merge of step card is withheld/);
    assert.equal(
      await project.approveRefusal(run.id, { ...decision, choice: "ship" }),
      "Step card has no choice ship; the choices offered are send-back, keep and discard.",
    );
    assert.deepEqual(waitingOf(await project.show(run.id)), waitingWithMergeWithheld);
    const second = await atCard(project, { merge: true, sendBack: false });
    const sendBackWithheld = contentOf({ "send-back": reasons.sendBack });
    assert.equal(
      await project.approveRefusal(second.id, {
        stepKey: "card",
        hash: hashOf(sendBackWithheld),
        choice: "send-back",
        by,
      }),
      "The choice send-back of step card is withheld: Round 2 is the last round.",
    );
  });
});

test("a decision that is accepted is no refusal", async () => {
  await withChooser(async (project) => {
    const run = await atCard(project, { merge: false, sendBack: true });
    const decision = { stepKey: "card", hash: hashOf(mergeWithheld), choice: "keep", by };
    await assert.rejects(project.approveRefusal(run.id, decision), /expected the decision to be refused/);
  });
});

test("a verdict where the approval offers choices is refused, and a choice where it offers none", async () => {
  await withChooser(async (project) => {
    const run = await atCard(project, { merge: false, sendBack: true });
    assert.equal(
      await project.approveRefusal(run.id, {
        stepKey: "card",
        hash: hashOf(mergeWithheld),
        verdict: "approve",
        by,
      }),
      "Step card offers choices, so a decision names one of them: merge, send-back, keep or discard.",
    );
    const plain = await project.runWorkflow("writer", "workflows/review.yaml", { name: "Ada" });
    const shown = { greeting: "Hello, Ada" };
    assert.equal(
      await project.approveRefusal(plain.id, { stepKey: "keep", hash: hashOf(shown), choice: "keep", by }),
      "Step keep offers no choices, so a decision approves or rejects what it shows.",
    );
  });
});

test("a decision on a hash that is not the one the approval shows is refused", async () => {
  await withChooser(async (project) => {
    const first = await atCard(project, { merge: false, sendBack: true });
    const second = await atCard(project, { merge: true, sendBack: false });
    const sendBackWithheld = contentOf({ "send-back": reasons.sendBack });
    assert.notEqual(hashOf(mergeWithheld), hashOf(sendBackWithheld));
    const stale = { stepKey: "card", hash: hashOf(mergeWithheld), choice: "keep", by };
    assert.equal(
      await project.approveRefusal(second.id, stale),
      `The hash ${hashOf(mergeWithheld)} is not the hash of what step card showed (${hashOf(sendBackWithheld)}).`,
    );
    assert.deepEqual((await project.approve(first.id, stale)).state, { status: "done", output: { taken: "keep" } });
  });
});

test("an approval waits for the same thing after the kernel under its run ends and the project is opened again, and a choice taken then completes the run", async () => {
  const beside = await projectWithChooser();
  let project = await openModeProject(config, { project: beside.root });
  try {
    const run = await atCard(project, { merge: false, sendBack: true });
    assert.deepEqual(waitingOf(run), waitingWithMergeWithheld);
    const root = project.root;
    const ended = project.endKernel();
    assert.equal(ended.root, root);
    assert.ok(existsSync(root));
    project = await ended.openAgain();
    assert.equal(project.root, root);
    assert.deepEqual(waitingOf(await project.show(run.id)), waitingWithMergeWithheld);
    assert.deepEqual(waitingOf(await project.resume(run.id)), waitingWithMergeWithheld);
    const decision = { stepKey: "card", hash: hashOf(mergeWithheld), by };
    assert.equal(
      await project.approveRefusal(run.id, { ...decision, choice: "merge" }),
      "The choice merge of step card is withheld: 1 must item is inconclusive.",
    );
    const decided = await project.approve(run.id, { ...decision, choice: "send-back" });
    assert.deepEqual(decided.state, { status: "done", output: { taken: "send-back" } });
    assert.deepEqual(await project.runs(), [{ id: run.id, status: "done" }]);
  } finally {
    await project.close();
    await beside.remove();
  }
  assert.ok(!existsSync(project.root));
});

test("a project whose kernel has ended is removed when it is closed", async () => {
  const beside = await projectWithChooser();
  try {
    const project = await openModeProject(config, { project: beside.root });
    const ended = project.endKernel();
    assert.ok(existsSync(ended.root));
    await ended.close();
    assert.ok(!existsSync(ended.root));
  } finally {
    await beside.remove();
  }
});
