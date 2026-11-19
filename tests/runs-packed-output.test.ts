import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, toJson } from "../bay/json.ts";
import { bay } from "./cli-fixture.ts";
import { makeProject, type Project } from "./project-fixture.ts";
import { openModeProject, type ModeProject, type Run } from "./test-toolbox.ts";

const config = { bindings: {}, adapter: "claude-code" };

const folder = "components/modes/scribe";

const noteLimit = 200_000;

const startAt = "2026-11-19T08:00:00.000Z";

const noteSkill = [
  "---",
  "name: note",
  "description: Writes a note on the topic given.",
  "metadata:",
  "  output: schemas/note.json",
  "---",
  "",
  "## Input",
  "",
  "A topic.",
  "",
  "## Output",
  "",
  "One note, as schemas/note.json.",
  "",
  "## Definition of done",
  "",
  "- [DOD-1] (must) The note is not a draft; scripts/not-a-draft.ts checks it.",
  "",
  "## Instructions",
  "",
  "1. Read the topic.",
  "2. Write the note.",
  "",
  "## Tools",
  "",
  "- files",
  "",
  "## Resources",
  "",
  "- the input",
  "",
  "## Rules and constraints",
  "",
  "- Write nothing.",
  "",
].join("\n");

const relayScript = [
  'import { defineScript, fail, fieldsOf } from "agentbay/sdk";',
  "",
  "function sumOf(text) {",
  "  let sum = 2166136261;",
  "  for (const character of text) {",
  "    sum = Math.imul(sum ^ (character.codePointAt(0) ?? 0), 16777619) >>> 0;",
  "  }",
  "  return sum.toString(16);",
  "}",
  "",
  "export const run = defineScript(async (input, context) => {",
  "  const answers = [];",
  "  for (const action of fieldsOf(input).calls) {",
  "    const answer = await context.call(action, { topic: action });",
  "    if (!answer.ok) {",
  "      fail(answer.message);",
  "    }",
  '    const text = typeof answer.value === "string" ? answer.value : JSON.stringify(answer.value);',
  "    answers.push({ length: text.length, sum: sumOf(text) });",
  "  }",
  "  return { answers };",
  "});",
  "",
].join("\n");

const notADraftScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input) => {",
  '  return typeof input === "string" && input.startsWith("draft")',
  '    ? { passed: false, feedback: "The note is still a draft." }',
  "    : { passed: true };",
  "});",
  "",
].join("\n");

const noteStep = { skill: "skills/note", tier: "balanced", checks: ["scripts/not-a-draft.ts"] };

const scribeManifest = {
  name: "scribe",
  version: "1.0.0",
  description: "Asks for notes, some kept packed and some kept as text, and returns only their sizes and sums.",
  actions: {
    note: {
      description: "When a note is written that the kernel keeps packed.",
      input: "schemas/any.json",
      output: "schemas/note.json",
      effects: ["read"],
      skillOutput: "kept-packed",
      run: [noteStep],
    },
    plain: {
      description: "When a note is written that the kernel keeps as text.",
      input: "schemas/any.json",
      output: "schemas/note.json",
      effects: ["read"],
      run: [noteStep],
    },
    relay: {
      description: "When notes are asked for one after another.",
      input: "schemas/any.json",
      output: "schemas/any.json",
      effects: ["read"],
      run: [{ script: "scripts/relay.ts" }],
    },
  },
};

const noteSchema = { type: "string", maxLength: noteLimit };

function schemaText(schema: Json): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

async function writeScribe(beside: Project, manifest: Json): Promise<void> {
  await beside.write(`${folder}/mode.yaml`, stringify(manifest));
  await beside.write(`${folder}/schemas/any.json`, "{}\n");
  await beside.write(`${folder}/schemas/note.json`, schemaText(noteSchema));
  await beside.write(`${folder}/skills/note/SKILL.md`, noteSkill);
  await beside.write(`${folder}/scripts/relay.ts`, relayScript);
  await beside.write(`${folder}/scripts/not-a-draft.ts`, notADraftScript);
}

async function withScribe(body: (project: ModeProject) => Promise<void>): Promise<void> {
  const beside = await makeProject();
  await writeScribe(beside, scribeManifest);
  const project = await openModeProject(config, { project: beside.root, startAt });
  try {
    await body(project);
  } finally {
    await project.close();
    await beside.remove();
  }
}

function tokenOf(run: Run): string {
  const token =
    run.state.status === "waiting" && run.state.waiting.reason === "skill" ? run.state.waiting.task.token : undefined;
  assert.ok(token !== undefined, `the run gives no skill task with a token: ${JSON.stringify(run.state)}`);
  return token;
}

function stepKeyOf(run: Run): string {
  assert.ok(run.state.status === "waiting", `expected the run to wait, got ${JSON.stringify(run.state)}`);
  return run.state.waiting.stepKey;
}

function sumOf(text: string): string {
  let sum = 2166136261;
  for (const character of text) {
    sum = Math.imul(sum ^ (character.codePointAt(0) ?? 0), 16777619) >>> 0;
  }
  return sum.toString(16);
}

function answered(text: string): Json {
  return { length: text.length, sum: sumOf(text) };
}

function linesOf(text: string): readonly string[] {
  return text.split("\n").filter((line) => line.trim().length > 3);
}

function formsOf(line: string): readonly string[] {
  return [line, JSON.stringify(line).slice(1, -1)];
}

async function filesUnder(root: string, at: string): Promise<readonly string[]> {
  const entries = await readdir(join(root, at), { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const path = `${at}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...(await filesUnder(root, path)));
    } else if (entry.isFile()) {
      found.push(path);
    }
  }
  return found;
}

async function filesHolding(root: string, text: string): Promise<readonly string[]> {
  const forms = linesOf(text)
    .flatMap(formsOf)
    .map((form) => Buffer.from(form, "utf8").toString("latin1"));
  const holding: string[] = [];
  for (const path of await filesUnder(root, ".agentbay")) {
    const content = (await readFile(join(root, path))).toString("latin1");
    if (forms.some((form) => content.includes(form))) {
      holding.push(path);
    }
  }
  return holding.sort();
}

function textHolds(shown: string, text: string): boolean {
  return linesOf(text)
    .flatMap(formsOf)
    .some((form) => shown.includes(form));
}

const kept = [
  "a quill zq1013 marks the north gate",
  'the second line zq1014 holds { a brace } and a "quote"',
  "é ü 🙂 zq1015 unicode line",
].join("\n");

const plain = ["a plain note zq2021 kept as text", "its second line zq2022 is plain too"].join("\n");

const draft = ["draft zq3031 the first try", "still rough zq3032 in round one"].join("\n");

const refused = ["refused zq4041 as an object", "never taken zq4042 by the schema"].join("\n");

function largeNote(): string {
  const lines: string[] = [];
  let length = 0;
  for (let index = 0; length < noteLimit; index += 1) {
    const line = `line ${String(index)} of the long kept note zq5${String(index).padStart(5, "0")}`;
    lines.push(line);
    length += line.length + 1;
  }
  return lines.join("\n").slice(0, noteLimit);
}

function sampled(text: string): string {
  const lines = text.split("\n");
  return lines.filter((_, index) => index % 97 === 0 || index === lines.length - 2).join("\n");
}

type Row = Readonly<Record<string, unknown>>;

function rowsOf(root: string, sql: string, runId: string): readonly Row[] {
  const database = new DatabaseSync(join(root, ".agentbay/kernel.db"), { readOnly: true });
  try {
    return database.prepare(sql).all(runId);
  } finally {
    database.close();
  }
}

test("an action not marked is stored as before: its steps' input, output and detail are the same bytes", async () => {
  await withScribe(async (project) => {
    const started = await project.run("scribe.relay", { calls: ["plain"] });
    const done = await project.answer(tokenOf(started), plain);
    assert.deepEqual(done.state, { status: "done", output: { answers: [answered(plain)] } });
    const steps = rowsOf(
      project.root,
      "select key, kind, status, input, output, detail from steps where run_id = ? order by rowid",
      started.id,
    );
    assert.deepEqual(
      steps.map((row) => ({ ...row })),
      [
        {
          key: "0",
          kind: "script",
          status: "done",
          input: '{"calls":["plain"]}',
          output: '{"answers":[{"length":68,"sum":"239dfcec"}]}',
          detail: '{"script":"scripts/relay.ts","stoppedForCall":{"items":0,"usd":0,"tokens":0,"minutes":0}}',
        },
        {
          key: "0.call0",
          kind: "call",
          status: "done",
          input: '{"topic":"plain"}',
          output: '"a plain note zq2021 kept as text\\nits second line zq2022 is plain too"',
          detail: '{"mode":"scribe","action":"plain"}',
        },
        {
          key: "0.call0/0",
          kind: "skill",
          status: "done",
          input: '{"topic":"plain"}',
          output: '"a plain note zq2021 kept as text\\nits second line zq2022 is plain too"',
          detail:
            '{"mode":"scribe","action":"plain","skill":"skills/note","tier":"balanced","schemas":["schemas/note.json"],"round":1,"feedback":[],"earlierSpent":{"items":0,"usd":0,"tokens":0,"minutes":0},"calledSpent":{"items":0,"usd":0,"tokens":0,"minutes":0},"submission":{"output":"a plain note zq2021 kept as text\\nits second line zq2022 is plain too","spent":{"items":0,"usd":0,"tokens":0,"minutes":0}}}',
        },
        {
          key: "0.call0/0#1.check0",
          kind: "check",
          status: "done",
          input: '"a plain note zq2021 kept as text\\nits second line zq2022 is plain too"',
          output: '{"passed":true}',
          detail: '{"script":"scripts/not-a-draft.ts"}',
        },
      ],
    );
    const runs = rowsOf(project.root, "select input, output from runs where id = ?", started.id);
    assert.deepEqual(
      runs.map((row) => ({ ...row })),
      [{ input: '{"calls":["plain"]}', output: '{"answers":[{"length":68,"sum":"239dfcec"}]}' }],
    );
  });
});

function stepsOf(json: unknown): readonly Json[] {
  const steps = fieldOf(fieldOf(toJson(json), "run") ?? null, "steps");
  assert.ok(Array.isArray(steps), JSON.stringify(json));
  return steps.map((step: unknown) => toJson(step));
}

const keptNote = "The kernel keeps this output packed and never shows it.";

async function answerEach(project: ModeProject, run: Run, texts: readonly string[]): Promise<Run> {
  let current = run;
  for (const text of texts) {
    const token = tokenOf(current.state.status === "waiting" ? await project.newToken(current.id) : current);
    current = await project.answer(token, text);
  }
  return current;
}

test("while the run waits for the next skill and after it ends, no file under .agentbay holds a line of the kept output", async () => {
  await withScribe(async (project) => {
    const started = await project.run("scribe.relay", { calls: ["plain", "note"] });
    const between = await project.answer(tokenOf(started), plain);
    assert.equal(stepKeyOf(between), "0.call1/0#1");
    const done = await project.answer(tokenOf(await project.newToken(started.id)), kept);
    assert.deepEqual(done.state, { status: "done", output: { answers: [answered(plain), answered(kept)] } });
    assert.deepEqual(await filesHolding(project.root, kept), []);
    assert.notDeepEqual(await filesHolding(project.root, plain), []);
  });
});

test("the kept output answered first is found nowhere while the unmarked one waits, and the script gets both whole", async () => {
  await withScribe(async (project) => {
    const started = await project.run("scribe.relay", { calls: ["note", "plain"] });
    const between = await project.answer(tokenOf(started), kept);
    assert.equal(stepKeyOf(between), "0.call1/0#1");
    assert.deepEqual(await filesHolding(project.root, kept), []);
    const done = await answerEach(project, between, [plain]);
    assert.deepEqual(done.state, { status: "done", output: { answers: [answered(kept), answered(plain)] } });
    assert.deepEqual(await filesHolding(project.root, kept), []);
  });
});

test("across a kernel restart between the answer and the replay, the script still receives the kept output whole", async () => {
  const beside = await makeProject();
  await writeScribe(beside, scribeManifest);
  let project = await openModeProject(config, { project: beside.root, startAt });
  try {
    const started = await project.run("scribe.relay", { calls: ["note", "plain"] });
    await project.answer(tokenOf(started), kept);
    const ended = project.endKernel();
    assert.deepEqual(await filesHolding(ended.root, kept), []);
    project = await ended.openAgain();
    const done = await answerEach(project, await project.show(started.id), [plain]);
    assert.deepEqual(done.state, { status: "done", output: { answers: [answered(kept), answered(plain)] } });
    assert.deepEqual(await filesHolding(project.root, kept), []);
  } finally {
    await project.close();
    await beside.remove();
  }
});

test("the check is given the kept output whole and sends a draft back, and neither round leaves a line as text", async () => {
  await withScribe(async (project) => {
    const started = await project.run("scribe.relay", { calls: ["note"] });
    const sentBack = await project.answer(tokenOf(started), draft);
    assert.equal(stepKeyOf(sentBack), "0.call0/0#2");
    assert.ok(sentBack.state.status === "waiting" && sentBack.state.waiting.reason === "skill");
    assert.deepEqual(sentBack.state.waiting.task.feedback, ["The note is still a draft."]);
    assert.deepEqual(await filesHolding(project.root, draft), []);
    const done = await project.answer(tokenOf(sentBack), kept);
    assert.deepEqual(done.state, { status: "done", output: { answers: [answered(kept)] } });
    assert.deepEqual(await filesHolding(project.root, `${draft}\n${kept}`), []);
  });
});

test("an answer the schema refuses leaves no line of it as text, and the run still takes the next answer", async () => {
  await withScribe(async (project) => {
    const started = await project.run("scribe.relay", { calls: ["note"] });
    const token = tokenOf(started);
    assert.equal(await project.answerRefusal(token, { text: refused }), "output must be text, but it is a mapping.");
    assert.deepEqual(await filesHolding(project.root, refused), []);
    const done = await project.answer(token, kept);
    assert.deepEqual(done.state, { status: "done", output: { answers: [answered(kept)] } });
    assert.deepEqual(await filesHolding(project.root, `${refused}\n${kept}`), []);
  });
});

test("an output of zero length is kept packed and reaches the script as an empty text", async () => {
  await withScribe(async (project) => {
    const started = await project.run("scribe.relay", { calls: ["note"] });
    const done = await project.answer(tokenOf(started), "");
    assert.deepEqual(done.state, { status: "done", output: { answers: [{ length: 0, sum: "811c9dc5" }] } });
    const full = stepsOf((await bay(["runs", started.id, "--full", "--json", "--project", project.root])).json);
    const keptSteps = full.filter((step) => fieldOf(step, "kept") === "kept-packed");
    assert.deepEqual(
      keptSteps.map((step) => fieldOf(step, "key")),
      ["0.call0", "0.call0/0", "0.call0/0#1.check0"],
    );
  });
});

test("an output at the schema's limit is kept packed and reaches the script whole", async () => {
  await withScribe(async (project) => {
    const large = largeNote();
    assert.equal(large.length, noteLimit);
    const started = await project.run("scribe.relay", { calls: ["note"] });
    const done = await project.answer(tokenOf(started), large);
    assert.deepEqual(done.state, { status: "done", output: { answers: [answered(large)] } });
    assert.deepEqual(await filesHolding(project.root, sampled(large)), []);
  });
});

test("bay runs says the output is kept packed and never prints it, plain, --full, --json and --events", async () => {
  await withScribe(async (project) => {
    const started = await project.run("scribe.relay", { calls: ["note"] });
    await project.answer(tokenOf(started), kept);
    const root = ["--project", project.root];
    const plainText = await bay(["runs", started.id, ...root]);
    assert.match(plainText.output, /0\.call0\/0 {2}skill {2}done {2}kept packed/);
    const shown = [
      plainText,
      await bay(["runs", started.id, "--full", ...root]),
      await bay(["runs", started.id, "--json", ...root]),
      await bay(["runs", started.id, "--full", "--json", ...root]),
      await bay(["runs", started.id, "--events", "--full", ...root]),
      await bay(["runs", started.id, "--events", "--full", "--json", ...root]),
    ];
    for (const ran of shown) {
      assert.equal(textHolds(ran.output, kept), false, ran.output);
    }
    const full = stepsOf((await bay(["runs", started.id, "--full", "--json", ...root])).json);
    const keptSteps = full.filter((step) => fieldOf(step, "kept") === "kept-packed");
    assert.deepEqual(
      keptSteps.map((step) => [fieldOf(step, "key"), fieldOf(step, "output")]),
      [
        ["0.call0", keptNote],
        ["0.call0/0", keptNote],
        ["0.call0/0#1.check0", { passed: true }],
      ],
    );
    assert.equal(fieldOf(keptSteps[2] ?? null, "input"), keptNote);
  });
});

test("a run of the kept action itself ends with its output kept packed, and bay runs shows only that", async () => {
  await withScribe(async (project) => {
    const started = await project.run("scribe.note", { topic: "alone" });
    const done = await project.answer(tokenOf(started), kept);
    assert.deepEqual(done.state, { status: "done", output: keptNote });
    const shown = await bay(["runs", started.id, "--full", "--events", "--project", project.root]);
    assert.match(shown.output, /output: kept packed/);
    assert.equal(textHolds(shown.output, kept), false, shown.output);
    assert.deepEqual(await filesHolding(project.root, kept), []);
  });
});

const keeperFolder = "components/modes/keeper";

const askerFolder = "components/modes/asker";

const keeperManifest = {
  name: "keeper",
  version: "1.0.0",
  description: "Serves notes that it keeps packed.",
  implements: ["note-source@1"],
  actions: {
    note: {
      description: "When a note is written that the kernel keeps packed.",
      effects: ["read"],
      skillOutput: "kept-packed",
      run: [{ skill: "skills/note", tier: "balanced" }],
    },
    twice: {
      description: "When a note is written and then looked at again.",
      input: "schemas/any.json",
      output: "schemas/any.json",
      effects: ["read"],
      skillOutput: "kept-packed",
      run: [{ skill: "skills/note", tier: "balanced" }, { script: "scripts/again.ts" }],
    },
  },
  workflows: ["workflows/own.yaml"],
};

const askerManifest = {
  name: "asker",
  version: "1.0.0",
  description: "Asks for notes in each way a mode can.",
  requires: { interfaces: ["note-source@1"] },
  actions: {
    direct: {
      description: "When a note is asked for by a call step.",
      input: "schemas/any.json",
      output: "schemas/any.json",
      effects: ["read"],
      run: [{ call: "note-source.note" }],
    },
    scripted: {
      description: "When a note is asked for by a script.",
      input: "schemas/any.json",
      output: "schemas/any.json",
      effects: ["read"],
      run: [{ script: "scripts/ask.ts" }],
    },
  },
  workflows: ["workflows/through.yaml"],
};

const askScript = [
  'import { defineScript, fail } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  '  const answer = await context.call("note-source.note", input);',
  "  return answer.ok ? { length: String(answer.value).length } : fail(answer.message);",
  "});",
  "",
].join("\n");

const noteSource = {
  name: "note-source",
  version: 1,
  actions: { note: { input: "note-source/any.json", output: "note-source/note.json", effects: ["read"] } },
};

const keeperSkill = noteSkill
  .replace("metadata:\n  output: schemas/note.json\n", "")
  .replace("- files\n", "You have the harness's tools to read files. Submit with `submit`.\n")
  .replace("- the input\n", "The input holds the topic.\n");

const examples: Readonly<Record<string, Json>> = {
  [`${keeperFolder}/tests/note.example.json`]: { input: { topic: "a" }, output: "A note." },
  [`${keeperFolder}/tests/twice.example.json`]: { input: { topic: "a" }, output: "A note." },
  [`${askerFolder}/tests/direct.example.json`]: { input: { topic: "a" }, output: "A note." },
  [`${askerFolder}/tests/scripted.example.json`]: { input: { topic: "a" }, output: { length: 7 } },
};

async function checkProject(): Promise<Project> {
  const beside = await makeProject();
  await beside.write(
    "agentbay.config.yaml",
    stringify({ bindings: { "greeting-source": "greeter", "note-source": "keeper" }, adapter: "fake" }),
  );
  await beside.write("components/interfaces/note-source.yaml", stringify(noteSource));
  await beside.write("components/interfaces/note-source/any.json", "{}\n");
  await beside.write("components/interfaces/note-source/note.json", schemaText(noteSchema));
  await beside.write(`${keeperFolder}/mode.yaml`, stringify(keeperManifest));
  await beside.write(`${keeperFolder}/schemas/any.json`, "{}\n");
  await beside.write(`${keeperFolder}/skills/note/SKILL.md`, keeperSkill);
  await beside.write(`${keeperFolder}/scripts/again.ts`, notADraftScript);
  await beside.write(
    `${keeperFolder}/workflows/own.yaml`,
    stringify({ name: "own", trigger: { manual: true }, steps: [{ id: "write", action: "note" }] }),
  );
  await beside.write(`${askerFolder}/mode.yaml`, stringify(askerManifest));
  await beside.write(`${askerFolder}/schemas/any.json`, "{}\n");
  await beside.write(`${askerFolder}/scripts/ask.ts`, askScript);
  await beside.write(
    `${askerFolder}/workflows/through.yaml`,
    stringify({
      name: "through",
      trigger: { manual: true },
      steps: [
        { id: "ask", action: "note-source.note" },
        { id: "look", approval: "Is this note good?", show: "$steps.ask.output" },
      ],
    }),
  );
  for (const [path, example] of Object.entries(examples)) {
    await beside.write(path, schemaText(example));
  }
  return beside;
}

test("bay check refuses, with a sentence, each place where a kept output would leave as text, and not a script's call", async () => {
  const beside = await checkProject();
  try {
    const checked = await bay(["check", "--project", beside.root]);
    const sentences = [
      "Action twice of mode keeper keeps its skill's output packed, but its run is not one skill step alone; " +
        "the kernel hands a kept output only to the script that called the action, so the action has no other step.",
      "Action direct of mode asker calls note-source.note, which keeps its skill's output packed; a call step " +
        "would pass that output on as text, and the kernel hands a kept output only to a script that calls the action.",
      "Step write of workflow workflows/own.yaml of mode keeper names note, which keeps its skill's output " +
        "packed; a workflow passes a step's output on as text, and the kernel hands a kept output only to a " +
        "script that calls the action.",
      "Step ask of workflow workflows/through.yaml of mode asker names note-source.note, which keeps its " +
        "skill's output packed; a workflow passes a step's output on as text, and the kernel hands a kept " +
        "output only to a script that calls the action.",
    ];
    for (const sentence of sentences) {
      assert.ok(checked.output.includes(sentence), checked.output);
    }
    assert.match(checked.output, /bay check: 4 errors/);
  } finally {
    await beside.remove();
  }
});
