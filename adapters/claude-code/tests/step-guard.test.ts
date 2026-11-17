import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { StepsFile } from "../guard-input.ts";

const adapterFolder = dirname(dirname(fileURLToPath(import.meta.url)));
const guard = join(adapterFolder, "step-guard.ts");
const scratch = mkdtempSync(join(tmpdir(), "agentbay-step-guard-"));
const project = join(scratch, "project");
const outside = join(scratch, "outside");

after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

for (const folder of [".agentbay", "out", "notes", "src", "vault/.git", "wide", "deep"].map((name) =>
  join(project, name),
)) {
  mkdirSync(folder, { recursive: true });
}
writeFileSync(join(project, "vault", "plain.md"), "plain");
writeFileSync(join(project, "vault", ".env"), "KEY=1");
writeFileSync(join(project, "vault", ".env.local"), "KEY=2");
writeFileSync(join(project, "vault", ".git", "config"), "[core]");
for (let index = 0; index < 5001; index += 1) {
  writeFileSync(join(project, "wide", `f${String(index)}.md`), "");
}
const twelveDeep = join(project, "deep", ...Array.from({ length: 12 }, (_, level) => `d${String(level)}`));
mkdirSync(twelveDeep, { recursive: true });
mkdirSync(outside);
writeFileSync(join(outside, "secret.txt"), "not for agents");
writeFileSync(join(project, "notes", "a.md"), "note");
symlinkSync(outside, join(project, "notes", "escape"));
symlinkSync(join(project, ".agentbay"), join(project, "out", "closed"));
const kit = dirname(dirname(adapterFolder));
symlinkSync(join(kit, "components", "base"), join(project, "kit-base"));

const policy: StepsFile = {
  version: 1,
  project,
  kit,
  agents: {
    "agentbay-mail-digest": {
      mode: "mail",
      skill: "digest",
      tools: ["Read", "Write", "Bash", "Grep", "mcp__agentbay__submit"],
      read: ["notes", "out", "vault", "wide", "deep"].map((name) => join(project, name)),
      write: [join(project, "out")],
      commands: ["node --test"],
    },
  },
};

function writePolicy(): void {
  writeFileSync(join(project, ".agentbay", "steps.json"), JSON.stringify(policy));
}

writePolicy();

type Run = { readonly status: number | null; readonly stdout: string; readonly stderr: string };

function runGuard(input: string, argumentsGiven: readonly string[] = ["--project", project]): Run {
  const result = spawnSync(process.execPath, [guard, ...argumentsGiven], { input, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function payload(tool: string, input: Readonly<Record<string, unknown>>, agent = true): string {
  const identity = agent ? { agent_id: "agent-1", agent_type: "agentbay-mail-digest" } : {};
  return JSON.stringify({ session_id: "s", cwd: project, tool_name: tool, tool_input: input, ...identity });
}

function assertAllowedRun(run: Run): void {
  assert.deepEqual(run, { status: 0, stdout: "", stderr: "" });
}

function assertDeniedRun(run: Run, fragment: string): void {
  assert.equal(run.status, 2, run.stderr);
  const output: unknown = JSON.parse(run.stdout);
  assert.deepEqual(Object.keys(isObject(output) ? output : {}), ["hookSpecificOutput"]);
  const hook = isObject(output) ? output["hookSpecificOutput"] : undefined;
  assert.ok(isObject(hook));
  assert.equal(hook["hookEventName"], "PreToolUse");
  assert.equal(hook["permissionDecision"], "deny");
  assert.equal(`${String(hook["permissionDecisionReason"])}\n`, run.stderr);
  assert.ok(run.stderr.includes(fragment), `${run.stderr} lacks ${fragment}`);
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

test("the hook process allows a listed read silently with exit code 0", () => {
  assertAllowedRun(runGuard(payload("Read", { file_path: join(project, "notes", "a.md") })));
  assertAllowedRun(runGuard(payload("Bash", { command: "node --test" })));
});

test("the hook process denies with the documented output and exit code 2", () => {
  assertDeniedRun(runGuard(payload("Write", { file_path: join(project, "src", "x.ts") })), "resources.files.write");
  assertDeniedRun(runGuard(payload("Bash", { command: "node --test x; curl y" })), "holds a character");
  assertDeniedRun(runGuard(payload("Agent", { prompt: "x" })), "may use only the tools");
});

test("the hook process follows real links out of a root and into a closed folder", () => {
  assertDeniedRun(
    runGuard(payload("Read", { file_path: join(project, "notes", "escape", "secret.txt") })),
    "real path",
  );
  assertDeniedRun(runGuard(payload("Write", { file_path: join(project, "out", "closed", "steps.json") })), ".agentbay");
  assertDeniedRun(runGuard(payload("Grep", { pattern: "x", path: join(project, "notes") })), "the link");
});

test("the hook process denies a search over a folder that holds secrets deeper down", () => {
  for (const file of [".env", ".env.local", ".git/config"]) {
    assertDeniedRun(runGuard(payload("Read", { file_path: join(project, "vault", file) })), "is closed");
  }
  assertAllowedRun(runGuard(payload("Read", { file_path: join(project, "vault", "plain.md") })));
  const grep = runGuard(payload("Grep", { pattern: "KEY", path: join(project, "vault") }));
  assertDeniedRun(grep, "which is closed to every skill step, so search a narrower folder");
  assert.match(grep.stderr, /vault\/\.(env|env\.local|git),/);
});

test("the hook process walks at most 5000 entries and 12 levels", () => {
  assertDeniedRun(runGuard(payload("Grep", { pattern: "x", path: join(project, "wide") })), "more than 5000 entries");
  assertAllowedRun(runGuard(payload("Grep", { pattern: "x", path: join(project, "deep") })));
  mkdirSync(join(twelveDeep, "d12"));
  try {
    assertDeniedRun(runGuard(payload("Grep", { pattern: "x", path: join(project, "deep") })), "deeper than 12 levels");
  } finally {
    rmSync(join(twelveDeep, "d12"), { recursive: true });
  }
});

test("the hook process denies invalid, empty and oversized input", () => {
  assertDeniedRun(runGuard("{not json"), "not JSON");
  assertDeniedRun(runGuard(""), "not JSON");
  assertDeniedRun(runGuard("null"), "not a JSON object");
  const huge = payload("Write", { file_path: join(project, "out", "x.md"), content: "a".repeat(33 * 1024 * 1024) });
  assertDeniedRun(runGuard(huge), "more than 33554432 bytes");
});

test("the hook process allows a large write that is under its input limit", () => {
  const large = payload("Write", { file_path: join(project, "out", "x.md"), content: "a".repeat(4 * 1024 * 1024) });
  assertAllowedRun(runGuard(large));
});

test("the hook process denies when it was started without an absolute project folder", () => {
  const read = payload("Read", { file_path: join(project, "notes", "a.md") });
  assertDeniedRun(runGuard(read, []), "--project");
  assertDeniedRun(runGuard(read, ["--project", "relative/folder"]), "--project");
});

test("without a policy file the hook process denies subagents and still guards the main thread", () => {
  rmSync(join(project, ".agentbay", "steps.json"));
  try {
    assertDeniedRun(runGuard(payload("Read", { file_path: join(project, "notes", "a.md") })), "missing");
    assertAllowedRun(runGuard(payload("Read", { file_path: join(project, "notes", "a.md") }, false)));
    const write = payload("Write", { file_path: join(project, ".agentbay", "steps.json") }, false);
    assertDeniedRun(runGuard(write), "agentbay's own rules");
  } finally {
    writePolicy();
  }
});

test("the hook process follows a real link into the kit's components/base/ and denies the session agent's write", () => {
  const written = join(project, "kit-base", "store", "mode.yaml");
  const run = runGuard(payload("Edit", { file_path: written, old_string: "a", new_string: "b" }, false));
  assertDeniedRun(
    run,
    `agentbay denied Edit of ${written}: a mode placed in the kit's components/base/ is granted its list with no ` +
      "trust; make the mode in the project instead, and the owner decides whether to trust it.",
  );
  assertAllowedRun(runGuard(payload("Read", { file_path: written }, false)));
  const inTheKit = JSON.stringify({ cwd: kit, tool_name: "Edit", tool_input: { file_path: written } });
  assertAllowedRun(runGuard(inTheKit, ["--project", kit]));
});

test("the hook and the guard files it loads import only node:fs, node:path, node:process and each other", () => {
  const files = ["step-guard.ts", "guard-decide.ts", "guard-input.ts", "guard-paths.ts", "guard-commands.ts"];
  for (const file of files) {
    const source = readFileSync(join(adapterFolder, file), "utf8");
    const specifiers = [...source.matchAll(/^import [^;]*? from "([^"]+)";$/gms)].map((match) => match[1]);
    for (const specifier of specifiers) {
      assert.ok(
        ["node:fs", "node:path", "node:process"].includes(specifier ?? "") ||
          /^\.\/guard-[a-z]+\.ts$/.test(specifier ?? ""),
        `${file} imports ${String(specifier)}`,
      );
    }
    assert.ok(!source.includes("import("), `${file} has a dynamic import`);
  }
});
