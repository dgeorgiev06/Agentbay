import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fieldOf, numberField, parseJson, textField } from "../bay/json.ts";
import { listOf } from "./cli-fixture.ts";
import { testEnvironment } from "./kernel-fixture.ts";
import { copyOfTheKit } from "./test-toolbox.ts";

const gitEnvironment = { ...testEnvironment, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

const worktrees = ["w1", "w2", "w3", "w4"].map((name) => join(".forge", "worktrees", name));

let copy: string;

function git(words: readonly string[]): void {
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t.invalid", ...words], {
    cwd: copy,
    env: gitEnvironment,
    stdio: "ignore",
  });
}

function bay(words: readonly string[]): { readonly status: number | null; readonly stdout: string } {
  const result = spawnSync(process.execPath, [join(copy, "bay", "cli.ts"), ...words], {
    cwd: copy,
    env: testEnvironment,
    input: "",
    encoding: "utf8",
  });
  return { status: result.status, stdout: `${result.stdout}${result.stderr}` };
}

function checkErrors(): { readonly count: number | undefined; readonly messages: readonly string[] } {
  const report = parseJson(bay(["check", "--json"]).stdout);
  const messages = listOf(fieldOf(report, "findings"))
    .filter((finding) => textField(finding, "severity") === "error")
    .map((finding) => textField(finding, "message") ?? "");
  return { count: numberField(report, "errors"), messages };
}

before(async () => {
  copy = await copyOfTheKit("worktree-check");
  git(["init", "--quiet"]);
  await writeFile(join(copy, ".git", "info", "exclude"), "node_modules\n");
  git(["add", "--all"]);
  git(["commit", "--quiet", "--no-gpg-sign", "--message", "base"]);
  for (const worktree of worktrees) {
    git(["worktree", "add", "--quiet", "--detach", worktree, "HEAD"]);
  }
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

test("bay check finds no error and bay build passes on the kit with four real forge worktrees open, more entries than one scan holds", () => {
  assert.deepEqual(checkErrors(), { count: 0, messages: [] });
  const built = bay(["build"]);
  assert.equal(built.status, 0, built.stdout);
  assert.equal(bay(["build", "--clean"]).status, 0);
});

test("an untracked .env in one forge worktree is the error of every forge step and stops the build", async () => {
  const secret = join(copy, worktrees[0] ?? "", ".env");
  await writeFile(secret, "");
  try {
    const { count, messages } = checkErrors();
    assert.ok(messages.length > 0);
    assert.equal(count, messages.length);
    assert.deepEqual(
      messages.filter((message) => !/^the step agentbay-forge-[a-z-]+ is granted /.test(message)),
      [],
    );
    assert.deepEqual(
      messages.filter((message) => !message.endsWith(`, which holds ${secret}`)),
      [],
    );
    const built = bay(["build"]);
    assert.notEqual(built.status, 0);
    assert.ok(built.stdout.includes(`, which holds ${secret}`), built.stdout);
  } finally {
    await rm(secret);
  }
});
