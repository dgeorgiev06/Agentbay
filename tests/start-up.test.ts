import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, parseJson, textField } from "../bay/json.ts";
import { bay, listOf } from "./cli-fixture.ts";
import { testEnvironment } from "./kernel-fixture.ts";
import { kit, makeProject, type Project } from "./project-fixture.ts";

type Started = {
  readonly kernelFiles: readonly string[];
  readonly packages: readonly string[];
  readonly compiled: readonly string[];
};

const recorder = fileURLToPath(new URL("start-up-recorder.ts", import.meta.url));

const kitPrefix = `${kit}/`;

const metaSchema = "Core and Validation specifications meta-schema";

const commandLineFiles = [
  "bay/answers.ts",
  "bay/bay-command.ts",
  "bay/cli.ts",
  "bay/command-context.ts",
  "bay/command-line.ts",
  "bay/commands.ts",
  "bay/commands/not-built.ts",
  "bay/json.ts",
  "bay/kernel-ports.ts",
  "bay/last-resort.ts",
  "bay/layout.ts",
  "bay/node-ports.ts",
  "bay/outcome.ts",
  "bay/owner-only.ts",
  "bay/secret-patterns.ts",
  "bay/terminal.ts",
];

const notForRuns = [
  "bay/build.ts",
  "bay/new.ts",
  "bay/tools.ts",
  "bay/settings-listing.ts",
  "bay/mcp.ts",
  "bay/mcp-server.ts",
  "bay/check.ts",
  "bay/import-scanner.ts",
];

let project: Project;
let records: string;
let runId: string;

before(async () => {
  project = await makeProject();
  records = await mkdtemp(join(tmpdir(), "agentbay-start-up-"));
  const called = await bay(["call", "writer.compose", '{"name":"Ada"}', "--project", project.root, "--json"]);
  runId = textField(fieldOf(parseJson(called.output), "run") ?? null, "id") ?? "";
  assert.notEqual(runId, "", called.output);
});

after(async () => {
  await project.remove();
  await rm(records, { recursive: true, force: true });
});

function textsOf(recorded: Json, name: string): readonly string[] {
  return listOf(fieldOf(recorded, name)).map((entry) => (typeof entry === "string" ? entry : ""));
}

function packageOf(url: string): string | undefined {
  return /\/node_modules\/((?:@[^/]+\/)?[^/]+)\//.exec(url)?.[1];
}

function kernelFileOf(url: string): string | undefined {
  const path = url.startsWith("file://") ? fileURLToPath(url) : url;
  return path.startsWith(kitPrefix) && packageOf(url) === undefined ? path.slice(kitPrefix.length) : undefined;
}

async function started(argv: readonly string[]): Promise<Started> {
  const record = join(records, `${String(Date.now())}-${argv.join("-").replace(/[^a-z-]/g, "")}.json`);
  const result = spawnSync(
    process.execPath,
    ["--import", recorder, join(kit, "bay", "cli.ts"), ...argv, "--project", project.root],
    { cwd: project.root, env: { ...testEnvironment, AGENTBAY_START_UP_RECORD: record }, input: "", encoding: "utf8" },
  );
  assert.ok(result.status === 0 || result.status === 1, `bay ${argv.join(" ")}: ${result.stdout}${result.stderr}`);
  const recorded = parseJson(await readFile(record, "utf8"));
  const loaded = textsOf(recorded, "loaded");
  const compiled = textsOf(recorded, "compiled");
  const kernelFiles = loaded.flatMap((url) => kernelFileOf(url) ?? []).filter((file) => !file.startsWith("tests/"));
  const packages = new Set(loaded.flatMap((url) => packageOf(url) ?? []));
  return {
    kernelFiles: [...new Set(kernelFiles)].sort(),
    packages: [...packages].sort(),
    compiled: [...compiled].sort(),
  };
}

function commandModules(files: readonly string[]): readonly string[] {
  return files.filter((file) => file.startsWith("bay/commands/") && file !== "bay/commands/not-built.ts");
}

test("bay --help and a command's --help load only the command line: no command module, Ajv or YAML", async () => {
  for (const argv of [["--help"], ["runs", "--help"], ["approve", "--help"]]) {
    const start = await started(argv);
    assert.deepEqual(start.kernelFiles, commandLineFiles, `bay ${argv.join(" ")}`);
    assert.deepEqual(start.packages, [], `bay ${argv.join(" ")}`);
    assert.deepEqual(start.compiled, [], `bay ${argv.join(" ")}`);
  }
});

test("bay runs <run> loads its own command and the kernel, not the build, an adapter, check, new or the tools", async () => {
  const start = await started(["runs", runId, "--json"]);
  assert.deepEqual(commandModules(start.kernelFiles), ["bay/commands/runs.ts"]);
  assert.ok(start.kernelFiles.includes("bay/kernel.ts"));
  assert.deepEqual(
    start.kernelFiles.filter((file) => notForRuns.includes(file) || file.startsWith("adapters/")),
    [],
  );
  assert.deepEqual(start.compiled, ["Config", metaSchema, "Interface", "Mode", "Workflow", "a project schema"].sort());
});

test("bay check loads the checks and no run, broker or kernel module, and compiles the meta-schema once", async () => {
  const start = await started(["check", "--json"]);
  assert.deepEqual(commandModules(start.kernelFiles), ["bay/commands/check.ts"]);
  assert.deepEqual(
    start.kernelFiles.filter(
      (file) => file.startsWith("bay/runs/") || file.startsWith("bay/broker/") || file === "bay/kernel.ts",
    ),
    [],
  );
  assert.equal(start.compiled.filter((name) => name === metaSchema).length, 1);
  assert.ok(start.compiled.includes("SkillFrontMatter"), start.compiled.join(", "));
});
