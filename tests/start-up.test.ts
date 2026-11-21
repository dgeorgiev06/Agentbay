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
  readonly checked: readonly string[];
};

const recorder = fileURLToPath(new URL("start-up-recorder.ts", import.meta.url));

const kitPrefix = `${kit}/`;

const metaSchema = "Core and Validation specifications meta-schema";

const commandLine = [
  "bay/answers.ts",
  "bay/bay-command.ts",
  "bay/cli.ts",
  "bay/command-context.ts",
  "bay/command-line.ts",
  "bay/commands.ts",
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

const readers = [
  "bay/contracts.ts",
  "bay/given-schema.ts",
  "bay/policy.ts",
  "bay/protocol-json.ts",
  "bay/roles.ts",
  "bay/schema-files.ts",
  "bay/trust.ts",
  "bay/value-check.ts",
  "bay/yaml-text.ts",
];

const forRuns = [
  ...commandLine,
  ...readers,
  "bay/agent-name.ts",
  "bay/approval-card.ts",
  "bay/approval-screen.ts",
  "bay/approval-words.ts",
  "bay/database-lock.ts",
  "bay/item-words.ts",
  "bay/kernel.ts",
  "bay/run-report.ts",
  "bay/secrets.ts",
  "bay/skill-tools.ts",
  "bay/trust-card.ts",
  "bay/waiting-report.ts",
];

const forCheck = [
  ...commandLine,
  ...readers,
  "bay/agent-name.ts",
  "bay/build.ts",
  "bay/check-context.ts",
  "bay/check-granted-folders.ts",
  "bay/check-imports.ts",
  "bay/check-layout.ts",
  "bay/check-limits.ts",
  "bay/check-skills.ts",
  "bay/check-trust.ts",
  "bay/check.ts",
  "bay/import-scanner.ts",
  "bay/skill-tools.ts",
];

function inFolder(folder: string, names: readonly string[]): readonly string[] {
  return names.map((name) => `${folder}/${name}.ts`);
}

const broker = inFolder("bay/broker", [
  "agent-query",
  "broker",
  "command-operations",
  "database-operations",
  "database-process",
  "file-access",
  "file-operations",
  "folder-links",
  "http-access",
  "http-operations",
  "list-in-force",
  "operations",
  "other-operations",
  "rule",
  "schema-operations",
  "script-protocol",
  "script-runner",
  "sql-statements",
  "step-broker",
]);

const runsFolder = inFolder("bay/runs", [
  "action-steps",
  "budget",
  "card",
  "choices",
  "cited-step",
  "draw-turns",
  "drawn-values",
  "engine",
  "foreach-steps",
  "given-steps",
  "hook-seen",
  "issued-tasks",
  "item-name",
  "kernel-migrations",
  "packed-output",
  "run-answers",
  "run-ending",
  "run-state",
  "run-store",
  "runs",
  "script-steps",
  "scrubbed-store",
  "side-by-side-steps",
  "side-by-side",
  "skill-steps",
  "sqlite-rows",
  "sqlite-run-store",
  "sqlite-task-tokens",
  "step-detail",
  "step-key",
  "task-tokens",
  "undo",
  "waiting",
  "walk",
  "workflow-part",
  "workflow-scope",
  "workflow-steps",
]);

const manifests = inFolder("bay/manifests", [
  "action-problems",
  "action-schemas",
  "activation",
  "binding-problems",
  "bindings",
  "file-references",
  "folders",
  "grants",
  "implements-problems",
  "inspection",
  "interfaces",
  "loaded",
  "loaded-mode",
  "manifests",
  "naming",
  "placement",
  "references",
  "schemas",
  "settings-problems",
  "spec",
  "workflow-problems",
]);

const kitSchemaFiles = ["config", "interface", "mode", "skill", "workflow"].map(
  (name) => `schemas/${name}.schema.json`,
);

const packages = ["ajv", "fast-deep-equal", "fast-uri", "json-schema-traverse", "yaml"];

const kitSchemas = ["Config", "Interface", "Mode", "Workflow"];

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
  const kernelFiles = loaded.flatMap((url) => kernelFileOf(url) ?? []).filter((file) => !file.startsWith("tests/"));
  const packages = new Set(loaded.flatMap((url) => packageOf(url) ?? []));
  return {
    kernelFiles: [...new Set(kernelFiles)].sort(),
    packages: [...packages].sort(),
    compiled: [...textsOf(recorded, "compiled")].sort(),
    checked: [...textsOf(recorded, "checked")].sort(),
  };
}

test("bay --help and a command's --help load only the command line: no command module, Ajv or YAML", async () => {
  for (const argv of [["--help"], ["runs", "--help"], ["approve", "--help"]]) {
    const start = await started(argv);
    assert.deepEqual(start.kernelFiles, [...commandLine, "bay/commands/not-built.ts"].sort(), `bay ${argv.join(" ")}`);
    assert.deepEqual(start.packages, [], `bay ${argv.join(" ")}`);
    assert.deepEqual(start.compiled, [], `bay ${argv.join(" ")}`);
  }
});

function projectSchemas(count: number): readonly string[] {
  return Array.from({ length: count }, () => "a project schema");
}

test("bay runs <run> loads its command and the kernel, not the build, an adapter, check, new or the tools", async () => {
  const start = await started(["runs", runId, "--json"]);
  const expected = [...forRuns, "bay/commands/not-built.ts", "bay/commands/runs.ts", ...broker, ...runsFolder];
  assert.deepEqual(start.kernelFiles, [...expected, ...manifests, ...kitSchemaFiles].sort());
  assert.deepEqual(start.packages, packages);
  assert.deepEqual(start.compiled, [...kitSchemas, metaSchema, ...projectSchemas(1)].sort());
  assert.deepEqual(start.checked, [...kitSchemas, ...projectSchemas(1)].sort());
});

test("bay check loads the checks and no run, broker or kernel module, and compiles each schema content it uses once", async () => {
  const start = await started(["check", "--json"]);
  const expected = [...forCheck, "bay/commands/check.ts", "bay/commands/not-built.ts", ...manifests];
  assert.deepEqual(start.kernelFiles, [...expected, ...kitSchemaFiles].sort());
  assert.deepEqual(start.packages, packages);
  const kitAndSkill = [...kitSchemas, "SkillFrontMatter"];
  assert.deepEqual(start.compiled, [...kitAndSkill, metaSchema, ...projectSchemas(4)].sort());
  assert.deepEqual(start.checked, [...kitAndSkill, ...projectSchemas(4)].sort());
});
