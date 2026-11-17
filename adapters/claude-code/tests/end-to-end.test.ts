import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdir, readdir, readFile, rm, rmdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { adapter } from "../adapter.ts";
import { buildRequest, skillAgent, type FilesWithRemoval } from "./build-fixture.ts";

const kit = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const scratch = mkdtempSync(join(tmpdir(), "agentbay adapter "));
const project = join(scratch, "my project");

const layout = { kit, project, configFile: join(project, "agentbay.config.yaml") };

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

const diskFiles: FilesWithRemoval = {
  readText: async (path) => readFile(path, "utf8").catch(() => undefined),
  list: async (directory) => readdir(directory).catch(() => []),
  exists: async (path) => (await readFile(path, "utf8").catch(() => undefined)) !== undefined,
  writeAtomic: async (path, text) => {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text);
  },
  removal: {
    remove: async (path) => {
      await rm(path, { recursive: false }).catch(async () => rmdir(path).catch(() => undefined));
    },
  },
};

const step = skillAgent({
  mode: "mail-briefing",
  skill: "digest",
  tier: "balanced",
  kernelTools: ["db_query"],
  read: [join(project, "notes")],
  write: [join(project, "out")],
  commands: [],
});

function hookCommand(): string {
  const settings: unknown = JSON.parse(readFileSync(join(project, ".claude", "settings.json"), "utf8"));
  const entries = typeof settings === "object" && settings !== null && "hooks" in settings ? settings.hooks : undefined;
  const text = JSON.stringify(entries);
  const match = /"command":"(node [^"]+)"/.exec(text);
  assert.ok(match?.[1] !== undefined, text);
  return match[1];
}

function runHook(command: string, payload: Readonly<Record<string, unknown>>): number | null {
  return spawnSync("sh", ["-c", command], { input: JSON.stringify(payload), encoding: "utf8" }).status;
}

function stepCall(tool: string, input: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
  return { tool_name: tool, tool_input: input, cwd: project, agent_id: "a1", agent_type: step.agent };
}

test("a real build registers a hook command that confines its step and cleans up after itself", async () => {
  mkdirSync(join(project, "notes"), { recursive: true });
  mkdirSync(join(project, "out"), { recursive: true });
  writeFileSync(join(project, "notes", "a.md"), "note");
  symlinkSync(join(project, ".agentbay"), join(project, "out", "closed"));
  const request = { ...buildRequest(diskFiles, [step]), layout };
  const outcome = await adapter.build(request);
  assert.ok(outcome.ok, JSON.stringify(outcome));
  const command = hookCommand();
  assert.equal(runHook(command, stepCall("Read", { file_path: join(project, "notes", "a.md") })), 0);
  assert.equal(runHook(command, stepCall("Write", { file_path: join(project, "out", "digest.md") })), 0);
  assert.equal(runHook(command, stepCall("mcp__agentbay__db_query", { token: "t", sql: "select 1" })), 0);
  assert.equal(runHook(command, stepCall("Write", { file_path: join(project, "notes", "a.md") })), 2);
  assert.equal(runHook(command, stepCall("Write", { file_path: join(project, "out", "closed", "steps.json") })), 2);
  assert.equal(runHook(command, stepCall("Read", { file_path: join(project, ".agentbay", "steps.json") })), 2);
  assert.equal(runHook(command, stepCall("Bash", { command: "ls" })), 2);
  assert.equal(runHook(command, stepCall("Agent", { prompt: "x" })), 2);
  const owner = {
    tool_name: "Edit",
    tool_input: { file_path: join(project, ".claude", "settings.json") },
    cwd: project,
  };
  assert.equal(runHook(command, owner), 2);
  assert.equal(runHook(command, { ...owner, tool_input: { file_path: join(project, "notes", "b.md") } }), 0);
  assert.equal(runHook(command, { ...owner, tool_input: { file_path: join(kit, "bay", "sdk.ts") } }), 2);
  const cleaned = await adapter.clean({ layout, files: diskFiles, removal: diskFiles.removal });
  assert.ok(cleaned.ok, JSON.stringify(cleaned));
  assert.equal(await diskFiles.readText(join(project, ".claude", "settings.json")), undefined);
  assert.equal(await diskFiles.readText(join(project, ".agentbay", "build.json")), undefined);
  assert.equal(await diskFiles.readText(join(project, "notes", "a.md")), "note");
  assert.deepEqual(readdirSync(project).sort(), ["notes", "out"]);
});
