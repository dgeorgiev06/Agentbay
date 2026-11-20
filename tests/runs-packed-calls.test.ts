import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, toJson } from "../bay/json.ts";
import { bay } from "./cli-fixture.ts";
import { makeProject, type Project } from "./project-fixture.ts";
import { openModeProject, type ModeProject, type Run } from "./test-toolbox.ts";

const config = { bindings: {}, adapter: "claude-code" };

const folder = "components/modes/vault";

const startAt = "2026-11-19T12:00:00.000Z";

const sumFunction = [
  "function sumOf(text) {",
  "  let sum = 2166136261;",
  "  for (const character of text) {",
  "    sum = Math.imul(sum ^ (character.codePointAt(0) ?? 0), 16777619) >>> 0;",
  "  }",
  "  return sum.toString(16);",
  "}",
];

const keepScript = [
  'import { defineScript, fail, fieldsOf } from "agentbay/sdk";',
  "",
  ...sumFunction,
  "",
  "function turned(given) {",
  "  const entries = Object.entries(fieldsOf(given));",
  '  return Object.fromEntries(entries.map(([name, value]) => [name, typeof value === "string" ? Array.from(value).reverse().join("") : value]));',
  "}",
  "",
  "export const run = defineScript(async (input, context) => {",
  "  const fields = fieldsOf(input);",
  "  const answers = [];",
  "  for (const asked of fields.calls) {",
  "    const { action, given } = fieldsOf(asked);",
  "    const answer = await context.call(action, turned(given));",
  "    if (answer.ok) {",
  "      const text = JSON.stringify(answer.value);",
  "      answers.push({ length: text.length, sum: sumOf(text) });",
  "    } else {",
  "      answers.push({ reason: answer.message });",
  "    }",
  "  }",
  "  if (fields.fail === true) {",
  '    fail("The keeper was asked to fail after its calls.");',
  "  }",
  "  return { answers };",
  "});",
  "",
].join("\n");

const echoScript = [
  'import { defineScript, fail } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  '  const answer = await context.call("inner", input);',
  "  return answer.ok ? { echoed: answer.value } : fail(answer.message);",
  "});",
  "",
].join("\n");

const innerScript = [
  'import { defineScript, fieldsOf } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input) => {",
  "  const text = fieldsOf(input).text;",
  "  return { text, again: text };",
  "});",
  "",
].join("\n");

const brokenScript = [
  'import { defineScript, fail, fieldsOf } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input) => {",
  "  fail(`the case quoted ${String(fieldsOf(input).text)}`);",
  "});",
  "",
].join("\n");

const misfitScript = [
  'import { defineScript, fieldsOf } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input) => {",
  "  return { count: fieldsOf(input).text };",
  "});",
  "",
].join("\n");

const nothingScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async () => null);",
  "",
].join("\n");

const noteSkill = [
  "---",
  "name: note",
  "description: Writes a note on the text given.",
  "metadata:",
  "  output: schemas/text.json",
  "---",
  "",
  "## Input",
  "",
  "A text.",
  "",
  "## Output",
  "",
  "One note, as schemas/text.json.",
  "",
  "## Definition of done",
  "",
  "- [DOD-1] (must) The note is not a draft; scripts/not-a-draft.ts checks it.",
  "",
  "## Instructions",
  "",
  "1. Read the text.",
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

function scriptAction(description: string, script: string, effects: readonly string[] = ["read"]): Json {
  return { description, input: "schemas/any.json", output: "schemas/any.json", effects, run: [{ script }] };
}

const keepRun = [{ script: "scripts/keep.ts" }];

const vaultManifest = {
  name: "vault",
  version: "1.0.0",
  description: "Calls actions whose answers are kept packed, and returns only their sizes and sums.",
  actions: {
    keep: {
      description: "When actions are called and their answers are to be kept packed.",
      input: "schemas/any.json",
      output: "schemas/any.json",
      effects: ["read", "write"],
      calledOutputs: "kept-packed",
      run: keepRun,
    },
    plain: {
      description: "When actions are called and their answers are kept as text.",
      input: "schemas/any.json",
      output: "schemas/any.json",
      effects: ["read", "write"],
      run: keepRun,
    },
    echo: scriptAction("When a text is handed on to inner and its answer given back.", "scripts/echo.ts"),
    relay: scriptAction("When a text is handed on to broken and its failure given back.", "scripts/relay.ts"),
    inner: scriptAction("When a text is given back twice.", "scripts/inner.ts"),
    broken: scriptAction("When a script fails with a message that quotes its input.", "scripts/broken.ts"),
    misfit: {
      description: "When an answer breaks its schema with a value from the input.",
      input: "schemas/any.json",
      output: "schemas/count.json",
      effects: ["read"],
      run: [{ script: "scripts/misfit.ts" }],
    },
    strict: {
      description: "When an input breaks the schema.",
      input: "schemas/count.json",
      output: "schemas/any.json",
      effects: ["read"],
      run: [{ script: "scripts/inner.ts" }],
    },
    wipe: scriptAction("When something is deleted.", "scripts/nothing.ts", ["delete"]),
    put: {
      description: "When a text is put away.",
      input: "schemas/any.json",
      output: "schemas/any.json",
      effects: ["write"],
      undo: "take",
      run: [{ script: "scripts/inner.ts" }],
    },
    take: scriptAction("When a text put away is taken back.", "scripts/nothing.ts", ["write"]),
    note: {
      description: "When a note is written on a text.",
      input: "schemas/any.json",
      output: "schemas/text.json",
      effects: ["read"],
      run: [{ skill: "skills/note", tier: "balanced", checks: ["scripts/not-a-draft.ts"] }],
    },
  },
};

function schemaText(schema: Json): string {
  return `${JSON.stringify(schema, null, 2)}\n`;
}

const countSchema = {
  type: "object",
  required: ["count"],
  properties: { count: { type: "number" } },
};

async function writeVault(beside: Project, manifest: Json): Promise<void> {
  await beside.write(`${folder}/mode.yaml`, stringify(manifest));
  await beside.write(`${folder}/schemas/any.json`, "{}\n");
  await beside.write(`${folder}/schemas/text.json`, schemaText({ type: "string" }));
  await beside.write(`${folder}/schemas/count.json`, schemaText(countSchema));
  await beside.write(`${folder}/skills/note/SKILL.md`, noteSkill);
  await beside.write(`${folder}/scripts/keep.ts`, keepScript);
  await beside.write(`${folder}/scripts/echo.ts`, echoScript);
  await beside.write(`${folder}/scripts/relay.ts`, echoScript.replace('"inner"', '"broken"'));
  await beside.write(`${folder}/scripts/inner.ts`, innerScript);
  await beside.write(`${folder}/scripts/broken.ts`, brokenScript);
  await beside.write(`${folder}/scripts/misfit.ts`, misfitScript);
  await beside.write(`${folder}/scripts/nothing.ts`, nothingScript);
  await beside.write(`${folder}/scripts/not-a-draft.ts`, notADraftScript);
}

async function withVault(body: (project: ModeProject) => Promise<void>): Promise<void> {
  const beside = await makeProject();
  await writeVault(beside, vaultManifest);
  const project = await openModeProject(config, { project: beside.root, startAt });
  try {
    await body(project);
  } finally {
    await project.close();
    await beside.remove();
  }
}

const secret = "the kept line zq7071 asserts a quill is counted once";

const answerLine = "the answer zq7072 quotes a test that must stay packed";

function sumOf(text: string): string {
  let sum = 2166136261;
  for (const character of text) {
    sum = Math.imul(sum ^ (character.codePointAt(0) ?? 0), 16777619) >>> 0;
  }
  return sum.toString(16);
}

function answered(value: Json): Json {
  const text = JSON.stringify(value);
  return { length: text.length, sum: sumOf(text) };
}

function turned(text: string): string {
  return Array.from(text).reverse().join("");
}

function called(action: string, text: string): Json {
  return { action, given: { text: turned(text) } };
}

function runsOf(text: string, length: number): readonly string[] {
  const characters = Array.from(text);
  const runs: string[] = [];
  for (let start = 0; start + length <= characters.length; start += 1) {
    runs.push(characters.slice(start, start + length).join(""));
  }
  return runs;
}

function formsOf(text: string): readonly string[] {
  const forms = [text, ...runsOf(text, 20)];
  return forms.flatMap((form) => [form, JSON.stringify(form).slice(1, -1)]);
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

async function filesHolding(root: string, texts: readonly string[]): Promise<readonly string[]> {
  const forms = texts.flatMap(formsOf).map((form) => Buffer.from(form, "utf8").toString("latin1"));
  const holding: string[] = [];
  for (const path of await filesUnder(root, ".agentbay")) {
    const content = (await readFile(join(root, path))).toString("latin1");
    if (forms.some((form) => content.includes(form))) {
      holding.push(path);
    }
  }
  return holding.sort();
}

function textHolds(shown: string, texts: readonly string[]): boolean {
  return texts.flatMap(formsOf).some((form) => shown.includes(form));
}

type Row = Readonly<Record<string, unknown>>;

function rowsOf(root: string, sql: string, runId: string): readonly Row[] {
  const database = new DatabaseSync(join(root, ".agentbay/kernel.db"), { readOnly: true });
  try {
    return database
      .prepare(sql)
      .all(runId)
      .map((row) => ({ ...row }));
  } finally {
    database.close();
  }
}

function keptByKey(root: string, runId: string): readonly Row[] {
  return rowsOf(root, "select key, kind, status, kept from steps where run_id = ? order by rowid", runId);
}

function outputOf(run: Run): Json {
  assert.ok(run.state.status === "done", JSON.stringify(run.state));
  return run.state.output;
}

function tokenOf(run: Run): string {
  const token =
    run.state.status === "waiting" && run.state.waiting.reason === "skill" ? run.state.waiting.task.token : undefined;
  assert.ok(token !== undefined, `the run gives no skill task with a token: ${JSON.stringify(run.state)}`);
  return token;
}

function stepsOf(json: unknown): readonly Json[] {
  const steps = fieldOf(fieldOf(toJson(json), "run") ?? null, "steps");
  assert.ok(Array.isArray(steps), JSON.stringify(json));
  return steps.map((step: unknown) => toJson(step));
}

const keptOutput = "The kernel keeps this output packed and never shows it.";

const keptInput = "The kernel keeps this input packed and never shows it.";

const keptReason = "The kernel keeps this reason packed and never shows it.";

test("the answers of calls under a marked action, at every depth, are in no file under .agentbay, and its script gets them whole", async () => {
  await withVault(async (project) => {
    const run = await project.run("vault.keep", { calls: [called("echo", secret), called("inner", answerLine)] });
    assert.deepEqual(outputOf(run), {
      answers: [
        answered({ echoed: { text: secret, again: secret } }),
        answered({ text: answerLine, again: answerLine }),
      ],
    });
    assert.deepEqual(await filesHolding(project.root, [secret, answerLine]), []);
    assert.deepEqual(keptByKey(project.root, run.id), [
      { key: "0", kind: "script", status: "done", kept: "as-text" },
      { key: "0.call0", kind: "call", status: "done", kept: "kept-packed" },
      { key: "0.call0/0", kind: "script", status: "done", kept: "kept-packed" },
      { key: "0.call0/0.call0", kind: "call", status: "done", kept: "kept-packed" },
      { key: "0.call0/0.call0/0", kind: "script", status: "done", kept: "kept-packed" },
      { key: "0.call1", kind: "call", status: "done", kept: "kept-packed" },
      { key: "0.call1/0", kind: "script", status: "done", kept: "kept-packed" },
    ]);
  });
});

test("the marked action's own step and run are kept as text, so its output stays readable", async () => {
  await withVault(async (project) => {
    const run = await project.run("vault.keep", { calls: [called("inner", secret)] });
    const own = { answers: [answered({ text: secret, again: secret })] };
    assert.deepEqual(outputOf(run), own);
    const rows = rowsOf(project.root, "select input, output from steps where run_id = ? and key = '0'", run.id);
    assert.deepEqual(rows, [
      { input: JSON.stringify({ calls: [called("inner", secret)] }), output: JSON.stringify(own) },
    ]);
  });
});

test("an action not marked keeps its calls' answers as text, as before", async () => {
  await withVault(async (project) => {
    const run = await project.run("vault.plain", { calls: [called("echo", secret)] });
    assert.deepEqual(outputOf(run), { answers: [answered({ echoed: { text: secret, again: secret } })] });
    assert.notDeepEqual(await filesHolding(project.root, [secret]), []);
    assert.ok(keptByKey(project.root, run.id).every((row) => row.kept === "as-text"));
  });
});

test("a called script's failure is handed to the marked script withheld, and its message is in no file", async () => {
  await withVault(async (project) => {
    const run = await project.run("vault.keep", { calls: [called("echo", secret), called("broken", answerLine)] });
    assert.deepEqual(outputOf(run), {
      answers: [
        answered({ echoed: { text: secret, again: secret } }),
        {
          reason:
            "The script scripts/broken.ts of action broken of mode vault failed; the kernel keeps its reason packed.",
        },
      ],
    });
    assert.deepEqual(await filesHolding(project.root, [secret, answerLine]), []);
  });
});

test("a failure two calls deep is handed up withheld at each script, and kept whole and packed where it began", async () => {
  await withVault(async (project) => {
    const run = await project.run("vault.keep", { calls: [called("relay", answerLine)] });
    assert.deepEqual(outputOf(run), {
      answers: [
        {
          reason:
            "The script scripts/relay.ts of action relay of mode vault failed; the kernel keeps its reason packed.",
        },
      ],
    });
    assert.deepEqual(await filesHolding(project.root, [answerLine]), []);
    const [deepest] = rowsOf(
      project.root,
      "select reason from steps where run_id = ? and key = '0.call0/0.call0/0'",
      run.id,
    );
    const stored = gunzipSync(Buffer.from(String(deepest?.reason), "base64")).toString("utf8");
    assert.equal(stored, `the case quoted ${answerLine}`);
  });
});

test("an answer that breaks its schema is counted, not quoted, and is in no file", async () => {
  await withVault(async (project) => {
    const run = await project.run("vault.keep", { calls: [called("misfit", secret)] });
    assert.deepEqual(outputOf(run), {
      answers: [
        {
          reason:
            "The output of action misfit of mode vault does not match its schema: 1 problem, not shown, since " +
            "the kernel keeps the output packed.",
        },
      ],
    });
    assert.deepEqual(await filesHolding(project.root, [secret]), []);
  });
});

test("an input that breaks the called action's schema is counted, not quoted, and is in no file", async () => {
  await withVault(async (project) => {
    const run = await project.run("vault.keep", { calls: [{ action: "strict", given: { count: turned(secret) } }] });
    assert.deepEqual(outputOf(run), {
      answers: [
        {
          reason:
            "The input of action strict of mode vault does not match its schema: 1 problem, not shown, since " +
            "the kernel keeps the input packed.",
        },
      ],
    });
    assert.deepEqual(await filesHolding(project.root, [secret]), []);
  });
});

test("the same misfit under an action not marked is quoted, as before", async () => {
  await withVault(async (project) => {
    const run = await project.run("vault.plain", { calls: [called("misfit", "short")] });
    assert.deepEqual(outputOf(run), {
      answers: [
        {
          reason:
            'The output of action misfit of mode vault does not match its schema: output.count must be a number, but it is "short".',
        },
      ],
    });
  });
});

test("a refused call keeps its input packed and gives the kernel's sentence", async () => {
  await withVault(async (project) => {
    const run = await project.run("vault.keep", { calls: [called("wipe", secret)] });
    assert.deepEqual(outputOf(run), {
      answers: [
        {
          reason:
            "The action keep of mode vault calls wipe, which has the effects delete that keep does not declare; " +
            "the call is refused.",
        },
      ],
    });
    assert.deepEqual(await filesHolding(project.root, [secret]), []);
    assert.deepEqual(keptByKey(project.root, run.id).slice(1), [
      { key: "0.call0", kind: "call", status: "failed", kept: "kept-packed" },
    ]);
  });
});

test("a call undone after the marked action fails is undone from its packed answer, and the undo is packed too", async () => {
  await withVault(async (project) => {
    const run = await project.run("vault.keep", { calls: [called("put", secret)], fail: true });
    assert.equal(run.state.status, "undone");
    assert.deepEqual(await filesHolding(project.root, [secret]), []);
    const undone = keptByKey(project.root, run.id).filter((row) => String(row.key).startsWith("undo"));
    assert.deepEqual(undone, [
      { key: "undo[0]", kind: "undo", status: "done", kept: "kept-packed" },
      { key: "undo[0]/0", kind: "script", status: "done", kept: "kept-packed" },
    ]);
  });
});

test("a skill under a called action waits with nothing in any file, and its answer reaches the script whole after a restart", async () => {
  const beside = await makeProject();
  await writeVault(beside, vaultManifest);
  let project = await openModeProject(config, { project: beside.root, startAt });
  try {
    const started = await project.run("vault.keep", { calls: [called("note", secret), called("inner", secret)] });
    assert.equal(tokenOf(started).length > 0, true);
    assert.deepEqual(await filesHolding(project.root, [secret]), []);
    const sentBack = await project.answer(tokenOf(started), `draft ${answerLine}`);
    assert.deepEqual(await filesHolding(project.root, [secret, answerLine]), []);
    const ended = project.endKernel();
    assert.deepEqual(await filesHolding(ended.root, [secret, answerLine]), []);
    project = await ended.openAgain();
    const again = await project.newToken(sentBack.id);
    const done = await project.answer(tokenOf(again), answerLine);
    assert.deepEqual(outputOf(done), {
      answers: [answered(answerLine), answered({ text: secret, again: secret })],
    });
    assert.deepEqual(await filesHolding(project.root, [secret, answerLine]), []);
    const rows = keptByKey(project.root, started.id);
    assert.deepEqual(
      rows.filter((row) => row.kept === "kept-packed").map((row) => row.key),
      ["0.call0", "0.call0/0", "0.call1", "0.call1/0", "0.call0/0#1.check0", "0.call0/0#2.check0"],
    );
  } finally {
    await project.close();
    await beside.remove();
  }
});

test("bay runs marks each packed step and prints none of its input, output or reason", async () => {
  await withVault(async (project) => {
    const run = await project.run("vault.keep", { calls: [called("echo", secret), called("broken", answerLine)] });
    const root = ["--project", project.root];
    const plainText = await bay(["runs", run.id, ...root]);
    assert.match(plainText.output, /0\.call0 {2}call {2}done {2}kept packed/);
    assert.match(plainText.output, /0\.call1\/0 {2}script {2}failed {2}kept packed/);
    assert.match(plainText.output, /\n {2}0 {2}script {2}done\n/);
    const shown = [
      plainText,
      await bay(["runs", run.id, "--full", ...root]),
      await bay(["runs", run.id, "--json", ...root]),
      await bay(["runs", run.id, "--full", "--json", ...root]),
      await bay(["runs", run.id, "--events", "--full", ...root]),
      await bay(["runs", run.id, "--events", "--full", "--json", ...root]),
    ];
    for (const ran of shown) {
      assert.equal(textHolds(ran.output, [secret, answerLine]), false, ran.output);
    }
    const full = stepsOf((await bay(["runs", run.id, "--full", "--json", ...root])).json);
    const kept = full.filter((step) => fieldOf(step, "kept") === "kept-packed");
    assert.deepEqual(
      kept.map((step) => [fieldOf(step, "key"), fieldOf(step, "input"), fieldOf(step, "output") ?? null]),
      [
        ["0.call0", keptInput, keptOutput],
        ["0.call0/0", keptInput, keptOutput],
        ["0.call0/0.call0", keptInput, keptOutput],
        ["0.call0/0.call0/0", keptInput, keptOutput],
        ["0.call1", keptInput, null],
        ["0.call1/0", keptInput, null],
      ],
    );
    assert.deepEqual(
      kept.filter((step) => fieldOf(step, "status") === "failed").map((step) => fieldOf(step, "reason")),
      [keptReason, keptReason],
    );
  });
});

const askerFolder = "components/modes/asker";

const tellerFolder = "components/modes/teller";

const answerSource = {
  name: "answer-source",
  version: 1,
  actions: { answer: { input: "answer-source/any.json", output: "answer-source/any.json", effects: ["read"] } },
};

const tellerManifest = {
  name: "teller",
  version: "1.0.0",
  description: "Tells an answer.",
  implements: ["answer-source@1"],
  actions: {
    answer: { description: "When an answer is asked for.", effects: ["read"], run: [{ script: "scripts/tell.ts" }] },
  },
};

const example = schemaText({ input: {}, output: null });

async function checkProject(manifest: Json): Promise<Project> {
  const beside = await makeProject();
  await beside.write(
    "agentbay.config.yaml",
    stringify({ bindings: { "greeting-source": "greeter", "answer-source": "teller" }, adapter: "fake" }),
  );
  await beside.write("components/interfaces/answer-source.yaml", stringify(answerSource));
  await beside.write("components/interfaces/answer-source/any.json", "{}\n");
  await beside.write(`${tellerFolder}/mode.yaml`, stringify(tellerManifest));
  await beside.write(`${tellerFolder}/scripts/tell.ts`, nothingScript);
  await beside.write(`${tellerFolder}/tests/answer.example.json`, example);
  await beside.write(`${askerFolder}/mode.yaml`, stringify(manifest));
  await beside.write(`${askerFolder}/schemas/any.json`, "{}\n");
  await beside.write(`${askerFolder}/scripts/ask.ts`, nothingScript);
  await beside.write(`${askerFolder}/tests/ask.example.json`, example);
  await beside.write(`${askerFolder}/tests/direct.example.json`, example);
  return beside;
}

function askerManifest(calledOutputs: string) {
  return {
    name: "asker",
    version: "1.0.0",
    description: "Asks for answers it keeps packed.",
    requires: { interfaces: ["answer-source@1"] },
    actions: {
      ask: {
        description: "When an answer is asked for by a script.",
        input: "schemas/any.json",
        output: "schemas/any.json",
        effects: ["read"],
        calledOutputs,
        run: [{ script: "scripts/ask.ts" }],
      },
      direct: {
        description: "When an answer is asked for by a call step.",
        input: "schemas/any.json",
        output: "schemas/any.json",
        effects: ["read"],
        calledOutputs: "kept-packed",
        run: [{ call: "answer-source.answer" }],
      },
    },
  };
}

async function checked(manifest: Json): Promise<string> {
  const beside = await checkProject(manifest);
  try {
    return (await bay(["check", "--project", beside.root])).output;
  } finally {
    await beside.remove();
  }
}

test("bay check refuses an unknown calledOutputs with a sentence", async () => {
  const output = await checked(askerManifest("kept-quiet"));
  const sentence = 'actions.ask.calledOutputs must be one of "as-text", "kept-packed", but it is "kept-quiet".';
  assert.ok(output.includes(sentence), output);
  assert.match(output, /bay check: 1 error,/);
});

test("bay check refuses a marked action whose run has a call step, with a sentence", async () => {
  const output = await checked(askerManifest("kept-packed"));
  const sentence =
    "Action direct of mode asker keeps the answers of the actions it calls packed, but its run has a call " +
    "step; a call step would pass that answer on as text, and the kernel hands a kept output only to a script " +
    "that calls the action.";
  assert.ok(output.includes(sentence), output);
  assert.match(output, /bay check: 1 error,/);
});

test("bay check takes a marked action whose run is scripts", async () => {
  const manifest = askerManifest("kept-packed");
  const output = await checked({ ...manifest, actions: { ask: manifest.actions.ask } });
  assert.match(output, /bay check: 0 errors/);
});
