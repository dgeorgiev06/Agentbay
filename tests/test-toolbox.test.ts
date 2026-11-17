import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import { openModeProject, type ModeProject } from "./test-toolbox.ts";

const toolboxFile = new URL("./test-toolbox.ts", import.meta.url);

const fakeSource = {
  bindings: {},
  adapter: "claude-code" as const,
  modes: ["fake-source", "store"],
  settings: { "fake-source": { baseDate: "2026-11-15T12:00:00.000Z", pageSize: 10, costPerItemUsd: 0.002 } },
};

async function withProject(body: (project: ModeProject) => Promise<void>): Promise<void> {
  const project = await openModeProject(fakeSource);
  try {
    await body(project);
  } finally {
    await project.close();
  }
}

function exportedNames(text: string): readonly string[] {
  const found = text.matchAll(/^export (?:async function|function|type|const) (\w+)/gm);
  return [...found].map((match) => match[1] ?? "").sort();
}

test("the test toolbox exports these names and no others", async () => {
  const text = await readFile(toolboxFile, "utf8");
  assert.deepEqual(exportedNames(text), [
    "CallOptions",
    "Decision",
    "ModeProject",
    "ProjectOptions",
    "Run",
    "openModeProject",
  ]);
  assert.deepEqual(text.match(/^export\b(?! (?:async function|function|type|const) \w+)/gm), null);
});

test("an opened project offers these operations and no others", async () => {
  const project = await openModeProject(fakeSource);
  try {
    assert.deepEqual(Object.keys(project).sort(), [
      "answer",
      "answerRefusal",
      "approve",
      "close",
      "extend",
      "failure",
      "output",
      "partition",
      "refusal",
      "reopen",
      "root",
      "run",
      "runWorkflow",
      "runs",
      "setTime",
    ]);
  } finally {
    await project.close();
  }
});

const innerFiles = ["../bay/kernel.ts", "../bay/runs/runs.ts", "../bay/ports.ts"];

function namesImportedFrom(text: string, files: readonly string[]): readonly string[] {
  const imports = text.matchAll(/^import (?:type )?\{([^}]*)\} from "([^"]+)";$/gm);
  return [...imports].flatMap(([, names = "", file = ""]) =>
    files.includes(file) || file.startsWith("../bay/broker/")
      ? names.split(",").map((name) => name.replace(/^\s*type\s+/, "").trim())
      : [],
  );
}

function declaredTypes(text: string): readonly string[] {
  return text
    .split(/^(?=export |type |function |async function |const )/m)
    .filter((part) => /^(?:export )?type /.test(part));
}

test("no type the test toolbox declares names the kernel, the runs entry, the broker or a port", async () => {
  const text = await readFile(toolboxFile, "utf8");
  const inner = namesImportedFrom(text, innerFiles);
  assert.deepEqual([...inner].sort(), ["Clock", "Kernel", "loadKernel", "nodeKernelPorts"]);
  const naming = declaredTypes(text).filter((part) => inner.some((name) => new RegExp(`\\b${name}\\b`).test(part)));
  assert.deepEqual(
    naming.map((part) => part.split("=")[0]?.trim()),
    ["type SettableClock"],
  );
});

test("a refused call is a refusal, never an output or a failure, and an accepted call is no refusal", async () => {
  await withProject(async (project) => {
    assert.equal(
      await project.refusal("fake-source.fetch", {}),
      "input is missing the required field selector. input is missing the required field cursor.",
    );
    await assert.rejects(project.output("fake-source.fetch", {}), /missing the required field selector/);
    await assert.rejects(project.failure("fake-source.fetch", {}), /missing the required field selector/);
    await assert.rejects(project.refusal("fake-source.describe", {}), /expected fake-source.describe to be refused/);
    await assert.rejects(project.failure("fake-source.describe", {}), /expected the run to fail/);
  });
});

test("runs lists each run with its id and where it stands", async () => {
  await withProject(async (project) => {
    assert.deepEqual(await project.runs(), []);
    const run = await project.run("fake-source.describe", {});
    assert.deepEqual(await project.runs(), [{ id: run.id, status: "done" }]);
  });
});

test("a mode's database is reached through the broker, with the rules a script's call has", async () => {
  await withProject(async (project) => {
    const partition = project.partition("store", "owner");
    assert.deepEqual(await partition.query("select 1 as one"), {
      ok: false,
      kind: "failed",
      message: "The mode store has no database yet; run its migrations first.",
    });
    assert.deepEqual(await partition.migrate(), { ok: true, value: ["0001-items.sql"] });
    const refused = await partition.query("select 1; select 2");
    assert.equal(
      refused.ok ? "" : refused.message,
      [
        "The step test-toolbox asked to run more than one statement in one call,",
        "but the broker runs exactly one statement per call. Send each statement in its own call.",
      ].join(" "),
    );
    assert.deepEqual(await partition.query("select count(*) as n from items"), { ok: true, value: [{ n: 0 }] });
  });
});

async function writeProjectMode(project: string): Promise<void> {
  const folder = join(project, "components/modes/echo");
  const manifest = {
    name: "echo",
    version: "1.0.0",
    description: "Gives back the text it is given.",
    actions: {
      say: {
        description: "When a test wants its text back.",
        input: "schemas/text.json",
        output: "schemas/text.json",
        effects: ["read"],
        run: [{ script: "scripts/say.ts" }],
      },
    },
  };
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: { text: { type: "string" } },
  };
  const files = {
    "mode.yaml": stringify(manifest),
    "schemas/text.json": `${JSON.stringify(schema)}\n`,
    "scripts/say.ts":
      'import { defineScript } from "agentbay/sdk";\n\nexport const run = defineScript(async (input) => input);\n',
  };
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), text, "utf8");
  }
}

test("a project beside the kit opens its own modes from its components folder", async () => {
  const beside = await realpath(await mkdtemp(join(tmpdir(), "agentbay-beside-")));
  try {
    await writeProjectMode(beside);
    const project = await openModeProject(
      { bindings: {}, adapter: "claude-code", modes: ["echo"] },
      { project: beside },
    );
    try {
      assert.deepEqual(await project.output("echo.say", { text: "hello" }), { text: "hello" });
    } finally {
      await project.close();
    }
  } finally {
    await rm(beside, { recursive: true, force: true });
  }
});
