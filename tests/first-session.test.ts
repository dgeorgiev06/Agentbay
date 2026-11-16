import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { parse, stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, numberField, parseJson, textField, isRecord } from "../bay/json.ts";
import { listOf } from "./cli-fixture.ts";
import { testEnvironment } from "./kernel-fixture.ts";
import { kit } from "./project-fixture.ts";

const project = realpathSync(mkdtempSync(join(tmpdir(), "agentbay-first-session-")));

const mode = join(project, "components", "modes", "notes");

after(() => {
  rmSync(project, { recursive: true, force: true });
});

type Ran = { readonly status: number | null; readonly json: Json; readonly output: string };

function bay(argv: readonly string[]): Ran {
  const result = spawnSync(process.execPath, [join(kit, "bay", "cli.ts"), ...argv, "--json"], {
    cwd: project,
    env: testEnvironment,
    input: "",
    encoding: "utf8",
  });
  const lines = result.stdout.split("\n").filter((line) => line !== "");
  assert.equal(lines.length, 1, `bay ${argv.join(" ")} printed:\n${result.stdout}\n${result.stderr}`);
  return { status: result.status, json: parseJson(lines[0] ?? ""), output: result.stdout };
}

function succeeded(argv: readonly string[]): Json {
  const ran = bay(argv);
  assert.equal(ran.status, 0, `bay ${argv.join(" ")}: ${ran.output}`);
  return ran.json;
}

function write(path: string, text: string): void {
  writeFileSync(join(mode, path), text);
}

function script(body: readonly string[]): string {
  return ['import { defineScript } from "agentbay/sdk";', "", ...body, ""].join("\n");
}

function text(value: unknown): string {
  return isRecord(value) && typeof value.text === "string" ? value.text : "";
}

const textSchema = `${JSON.stringify({ type: "object", required: ["text"], properties: { text: { type: "string" } } })}\n`;

function makeTheActionScriptSkillScript(): void {
  const manifest: unknown = parse(readFileSync(join(mode, "mode.yaml"), "utf8"));
  assert.ok(isRecord(manifest));
  const tidy = {
    description: "When the owner wants the notes tidied.",
    input: "schemas/tidy-input.json",
    output: "schemas/tidy-output.json",
    effects: ["read", "write"],
    run: [
      { script: "scripts/tidy.ts" },
      { skill: "skills/tidy-up", tier: "fast", checks: ["scripts/long-enough.ts"] },
      { script: "scripts/finish.ts" },
    ],
  };
  const edited = { ...manifest, resources: { files: { write: ["out/notes/"] } }, actions: { tidy } };
  writeFileSync(join(mode, "mode.yaml"), stringify(edited));
  for (const name of ["tidy-input", "tidy-output", "draft"]) {
    write(`schemas/${name}.json`, textSchema);
  }
  write("tests/tidy.example.json", JSON.stringify({ input: { text: "a b" }, output: { text: "A B, tidied up." } }));
  write(
    "scripts/long-enough.ts",
    script([
      "export const run = defineScript(async (input) => {",
      '  const text = typeof input === "object" && input !== null && "text" in input ? String(input.text) : "";',
      '  return text.length >= 12 ? { passed: true } : { passed: false, feedback: "Write at least 12 characters." };',
      "});",
    ]),
  );
  write("scripts/finish.ts", script(["export const run = defineScript((input) => Promise.resolve(input));"]));
  const skill = readFileSync(join(mode, "skills", "tidy-up", "SKILL.md"), "utf8")
    .replace("description: Replace", "metadata:\n  output: schemas/draft.json\ndescription: Replace")
    .replace(/## Tools\n\n.*\n/, "## Tools\n\n- files\n")
    .replace(/## Resources\n\n.*\n/, "## Resources\n\n- out/notes/\n");
  write("skills/tidy-up/SKILL.md", skill);
}

function kitState(): string {
  return execFileSync("git", ["status", "--porcelain", "--ignored=matching"], { cwd: kit, encoding: "utf8" });
}

function projectFiles(folder = project): ReadonlyMap<string, string> {
  const files = new Map<string, string>();
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    if (name === ".git" || name === ".agentbay") {
      continue;
    }
    if (statSync(path).isDirectory()) {
      for (const [inner, content] of projectFiles(path)) {
        files.set(inner, content);
      }
    } else {
      files.set(path.slice(project.length + 1), readFileSync(path, "utf8"));
    }
  }
  return files;
}

function hookStatus(command: string, payload: Json): number | null {
  return spawnSync("sh", ["-c", command], { input: JSON.stringify(payload), encoding: "utf8" }).status;
}

function hookCommandOf(): string {
  const settings: unknown = JSON.parse(readFileSync(join(project, ".claude", "settings.json"), "utf8"));
  const command = JSON.stringify(settings).match(/"command":"(node [^"]+)"/)?.[1];
  assert.ok(command !== undefined, JSON.stringify(settings));
  return command;
}

function taskOf(json: Json): Json {
  const task = fieldOf(fieldOf(json, "run") ?? null, "task");
  assert.ok(task !== undefined, JSON.stringify(json));
  return task;
}

test("the owner's first session in a fresh project beside the kit runs from new to build --clean", () => {
  const kitBefore = kitState();
  execFileSync("git", ["init", "-q"], { cwd: project });
  writeFileSync(join(project, "agentbay.config.yaml"), "bindings: {}\nadapter: claude-code\n");

  succeeded(["new", "mode", "notes", "--tier", "modes"]);
  succeeded(["new", "action", "tidy", "--mode", "notes"]);
  succeeded(["new", "skill", "tidy-up", "--mode", "notes"]);
  succeeded(["new", "workflow", "daily", "--mode", "notes"]);
  assert.match(readFileSync(join(mode, "scripts", "tidy.ts"), "utf8"), /from "agentbay\/sdk"/);
  makeTheActionScriptSkillScript();
  mkdirSync(join(project, "out", "notes"), { recursive: true });
  writeFileSync(join(project, "out", "notes", "earlier.md"), "notes from before agentbay");
  writeFileSync(join(project, "private.md"), "not for the step");

  const checked = succeeded(["check"]);
  assert.equal(fieldOf(checked, "errors"), 0, JSON.stringify(checked));
  for (const finding of listOf(fieldOf(checked, "findings"))) {
    assert.equal(textField(finding, "severity"), "warning");
    assert.match(textField(finding, "file") ?? "", /^kit:components\//);
  }

  const beforeBuild = projectFiles();
  succeeded(["build"]);
  const agentFile = readFileSync(join(project, ".claude", "agents", "agentbay-notes-tidy-up.md"), "utf8");
  assert.ok(agentFile.includes(join(mode, "skills", "tidy-up", "SKILL.md")));
  const steps: unknown = JSON.parse(readFileSync(join(project, ".agentbay", "steps.json"), "utf8"));
  assert.ok(isRecord(steps));
  assert.equal(steps.project, project);
  assert.equal(steps.kit, kit);
  const mcp = readFileSync(join(project, ".mcp.json"), "utf8");
  assert.ok(mcp.includes(join(kit, "bay", "mcp.ts")) && mcp.includes(project));
  const claude = readFileSync(join(project, "CLAUDE.md"), "utf8");
  assert.ok(claude.includes(`\`${join(kit, "bay.sh")} --project ${project} call <mode.action>`), claude);
  assert.equal(kitState(), kitBefore);

  const hook = hookCommandOf();
  const asStep = { cwd: project, agent_id: "agent-1", agent_type: "agentbay-notes-tidy-up", tool_name: "Write" };
  const inside = { file_path: join(project, "out", "notes", "draft.md"), content: "x" };
  assert.equal(hookStatus(hook, { ...asStep, tool_input: inside }), 0);
  assert.equal(hookStatus(hook, { ...asStep, tool_input: { file_path: join(kit, "components", "x.md") } }), 2);
  assert.equal(hookStatus(hook, { ...asStep, tool_input: { file_path: join(kit, "bay", "sdk.ts") } }), 2);

  const called = taskOf(succeeded(["call", "notes.tidy", '{"text":"tidy me"}']));
  assert.equal(textField(called, "agent"), "agentbay-notes-tidy-up");
  assert.equal(textField(called, "skillFile"), join(mode, "skills", "tidy-up", "SKILL.md"));
  const runId = textField(called, "runId") ?? "";
  const token = textField(called, "token") ?? "";
  const read = succeeded(["call", "--tool", "files_read", JSON.stringify({ token, path: "out/notes/earlier.md" })]);
  assert.equal(textField(fieldOf(read, "result") ?? null, "text"), "notes from before agentbay");
  const refused = bay(["call", "--tool", "files_read", JSON.stringify({ token, path: "private.md" })]);
  assert.equal(refused.status, 1, refused.output);
  assert.equal(refused.output.includes("not for the step"), false);

  const short = taskOf(succeeded(["submit", '{"text":"short"}', "--token", token]));
  assert.equal(numberField(short, "round"), 2);
  assert.deepEqual(fieldOf(short, "feedback"), ["Write at least 12 characters."]);
  const retry = textField(short, "token") ?? "";
  const done = succeeded(["submit", '{"text":"tidy me, tidied"}', "--token", retry]);
  const run = fieldOf(done, "run") ?? null;
  assert.equal(textField(run, "status"), "done");
  assert.equal(text(fieldOf(run, "output")), "tidy me, tidied");

  const runs = listOf(fieldOf(succeeded(["runs"]), "runs"));
  assert.deepEqual(
    runs.map((entry) => [textField(entry, "id"), textField(entry, "status")]),
    [[runId, "done"]],
  );

  succeeded(["build", "--clean"]);
  assert.deepEqual(projectFiles(), beforeBuild);
  assert.equal(kitState(), kitBefore);
});
