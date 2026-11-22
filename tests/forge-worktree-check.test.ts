import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fieldOf, parseJson, textField } from "../bay/json.ts";
import { listOf } from "./cli-fixture.ts";
import { testEnvironment } from "./kernel-fixture.ts";
import { copyOfTheKit } from "./test-toolbox.ts";

const gitEnvironment = { ...testEnvironment, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

const worktree = join(".forge", "worktrees", "w1");

let copy: string;

let messages: readonly string[];

function git(words: readonly string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", ...words], {
    cwd: copy,
    env: gitEnvironment,
    stdio: "ignore",
  });
}

before(async () => {
  copy = await copyOfTheKit("worktree-check");
  git(["init", "--quiet"]);
  await writeFile(join(copy, ".git", "info", "exclude"), "node_modules\n");
  git(["add", "--all"]);
  git(["commit", "--quiet", "--no-gpg-sign", "--message", "base"]);
  git(["worktree", "add", "--quiet", "--detach", worktree, "HEAD"]);
  messages = errorMessages();
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

function errorMessages(): readonly string[] {
  const result = spawnSync(process.execPath, [join(copy, "bay", "cli.ts"), "check", "--json"], {
    cwd: copy,
    env: testEnvironment,
    input: "",
    encoding: "utf8",
  });
  const findings = listOf(fieldOf(parseJson(result.stdout), "findings"));
  return findings
    .filter((finding) => textField(finding, "severity") === "error")
    .map((finding) => textField(finding, "message") ?? "");
}

test("bay check on the kit with a real forge worktree open does not report the worktree's .git pointer", () => {
  const pointer = join(copy, worktree, ".git");
  assert.deepEqual(
    messages.filter((message) => message.includes(pointer)),
    [],
  );
});

test("the only granted-folder errors left name the worktree's checked-out config, which waits for the owner", () => {
  const config = join(copy, worktree, "agentbay.config.yaml");
  assert.ok(messages.length > 0);
  assert.deepEqual(
    messages.filter((message) => !message.endsWith(`, which holds ${config}`)),
    [],
  );
});
