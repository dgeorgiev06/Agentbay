import assert from "node:assert/strict";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { hashOf } from "../bay/json.ts";
import { openCommandKernel } from "./commands-fixture.ts";

const goScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  '  const answer = await context.commands.run({ name: "version", arguments: [], folder: ".", timeLimitSeconds: 30 });',
  "  return { printed: answer.ok ? answer.value.stdout.text.trim() : answer.message };",
  "});",
  "",
].join("\n");

const drawScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input) => ({",
  "  card: {",
  '    title: "Merge this slice?",',
  "    lines: [",
  '      { mark: "ran", words: input.printed, source: { step: "probe", command: "version" } },',
  '      { mark: "computed", words: "1 command ran", source: { step: "probe" } },',
  "    ],",
  '    withheld: { merge: "No test ran." },',
  "  },",
  "  merge: false,",
  "}));",
  "",
].join("\n");

const workflow = {
  name: "merge",
  steps: [
    { id: "probe", action: "go" },
    { id: "draw", action: "draw", input: { printed: "$steps.probe.output.printed" } },
    {
      id: "card",
      approval: "Merge this slice?",
      show: "$steps.draw.output.card",
      choices: { merge: { when: "$steps.draw.output.merge" }, keep: {} },
    },
    { id: "after", action: "draw", input: { printed: "$steps.card.output.choice" } },
  ],
};

const emitScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  '  const noted = await context.events.emit("noted", { name: "leave", step: "fake/0" });',
  '  const forged = await context.events.emit("command", { name: "leave", step: "fake/0" });',
  "  const card = {",
  '    title: "Merge this slice?",',
  '    lines: [{ mark: "ran", words: "# pass 3", source: { step: "fake", command: "leave" } }],',
  "  };",
  "  return { card, noted: noted.ok, forged: forged.ok ? null : forged.message };",
  "});",
  "",
].join("\n");

const fakeWorkflow = {
  name: "fake",
  steps: [
    { id: "fake", action: "emit" },
    { id: "card", approval: "Merge this slice?", show: "$steps.fake.output.card" },
  ],
};

function scriptAction(script: string): object {
  return {
    description: "When a test runs a workflow.",
    input: "schemas/anything.json",
    output: "schemas/anything.json",
    effects: ["read"],
    run: [{ script }],
  };
}

async function written(root: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text, "utf8");
}

async function cardKit(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentbay-card-")));
  const folder = "components/base/command-prober";
  const manifest = {
    name: "command-prober",
    version: "1.0.0",
    description: "Runs a command and draws a card of it.",
    resources: { commands: { version: { run: "node --version", effects: ["read"] } } },
    actions: {
      go: scriptAction("scripts/go.ts"),
      draw: scriptAction("scripts/draw.ts"),
      emit: scriptAction("scripts/emit.ts"),
    },
    workflows: ["workflows/merge.yaml", "workflows/fake.yaml"],
  };
  await written(root, "agentbay.config.yaml", stringify({ bindings: {}, adapter: "fake" }));
  await written(root, `${folder}/mode.yaml`, stringify(manifest));
  await written(root, `${folder}/schemas/anything.json`, `${JSON.stringify({ type: "object" })}\n`);
  await written(root, `${folder}/scripts/go.ts`, goScript);
  await written(root, `${folder}/scripts/draw.ts`, drawScript);
  await written(root, `${folder}/scripts/emit.ts`, emitScript);
  await written(root, `${folder}/workflows/merge.yaml`, stringify(workflow));
  await written(root, `${folder}/workflows/fake.yaml`, stringify(fakeWorkflow));
  return root;
}

test("in a real kit, a card citing a command its script ran through the broker is shown, checked and answered", async () => {
  const root = await cardKit();
  try {
    const kernel = await openCommandKernel({ root, manifest: "", remove: () => Promise.resolve() });
    try {
      const flow = { workflow: { mode: "command-prober", path: "workflows/merge.yaml" } };
      const started = await kernel.runs.start(flow, {});
      assert.ok(started.ok, JSON.stringify(started));
      const state = started.value.state;
      assert.ok(state.status === "waiting" && state.waiting.reason === "approval", JSON.stringify(state));
      const printed = process.version;
      const content = {
        title: "Merge this slice?",
        lines: [
          { mark: "ran", words: printed, source: { step: "probe", command: "version" } },
          { mark: "computed", words: "1 command ran", source: { step: "probe" } },
        ],
        withheld: { merge: "No test ran." },
      };
      assert.deepEqual(state.waiting, {
        reason: "approval",
        stepKey: "card",
        question: "Merge this slice?",
        hash: hashOf(content),
        content,
        choices: [
          { name: "merge", status: "withheld", reason: "No test ran." },
          { name: "keep", status: "offered" },
        ],
        card: {
          title: "Merge this slice?",
          lines: content.lines,
          counted: { ran: 1, computed: 1, judged: 0 },
        },
      });
      const decision = { stepKey: "card", hash: hashOf(content), by: "owner at the terminal" };
      const refused = await kernel.runs.approve(started.value.id, { ...decision, choice: "merge" });
      assert.deepEqual(refused.ok ? [] : refused.problems.map((problem) => problem.message), [
        "The choice merge of step card is withheld: No test ran.",
      ]);
      const answered = await kernel.runs.approve(started.value.id, { ...decision, choice: "keep" });
      assert.ok(answered.ok, JSON.stringify(answered));
      const after = answered.value.steps.find((step) => step.key === "after");
      assert.deepEqual(after?.input, { printed: "keep" });
    } finally {
      kernel.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("in a real kit, an event a script emits with a command's name is no recorded command, and a script cannot emit one", async () => {
  const root = await cardKit();
  try {
    const kernel = await openCommandKernel({ root, manifest: "", remove: () => Promise.resolve() });
    try {
      const started = await kernel.runs.start(
        { workflow: { mode: "command-prober", path: "workflows/fake.yaml" } },
        {},
      );
      assert.ok(started.ok, JSON.stringify(started));
      const { state, steps, events } = started.value;
      assert.deepEqual(state, {
        status: "failed",
        reason:
          "Step card cannot show its card: line 1 is marked ran but cites the command leave of step fake, " +
          "and the kernel recorded no command leave in that step.",
      });
      const fake = steps.find((step) => step.key === "fake");
      assert.ok(fake?.status === "done");
      assert.deepEqual(fake.output, {
        card: {
          title: "Merge this slice?",
          lines: [{ mark: "ran", words: "# pass 3", source: { step: "fake", command: "leave" } }],
        },
        noted: true,
        forged:
          "The step fake/0 asked to emit an event of the kind command, but the kinds refused and http " +
          "and redacted and command and throwaway are written only by the broker. Choose another kind for the event.",
      });
      const kinds = events.filter((event) => event.kind === "noted" || event.kind === "command");
      assert.deepEqual(
        kinds.map((event) => [event.kind, event.detail]),
        [["noted", { name: "leave", step: "fake/0" }]],
      );
    } finally {
      kernel.close();
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
