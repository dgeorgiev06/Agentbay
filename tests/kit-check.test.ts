import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fieldOf, numberField, parseJson, textField } from "../bay/json.ts";
import { listOf } from "./cli-fixture.ts";
import { testEnvironment } from "./kernel-fixture.ts";
import { kit } from "./project-fixture.ts";

test("the real bay check on the kit itself reports no errors, the two size warnings and one per listed command of each mode", () => {
  const result = spawnSync(process.execPath, [join(kit, "bay", "cli.ts"), "check", "--json"], {
    cwd: kit,
    env: testEnvironment,
    input: "",
    encoding: "utf8",
  });
  const report = parseJson(result.stdout);
  const findings = listOf(fieldOf(report, "findings")).map((finding) => [
    textField(finding, "severity"),
    textField(finding, "file"),
    numberField(finding, "line"),
    (textField(finding, "message") ?? "").replace(/ is \d+,/, " is N,"),
  ]);
  const listedBy =
    (mode: string) =>
    (line: number, command: string): readonly unknown[] => [
      "warning",
      `components/base/${mode}/mode.yaml`,
      line,
      `Mode ${mode} lists the command ${command}; a listed command can run code the agent wrote.`,
    ];
  const listed = listedBy("typescript");
  const listedGit = listedBy("git-worktrees");
  const git =
    "git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c submodule.recurse=false " +
    "--attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904";
  const committing = `${git} -c user.name=agentbay-git-worktrees -c user.email=git-worktrees@agentbay.invalid -c gc.auto=0`;
  assert.deepEqual(findings, [
    listedGit(12, `${git} rev-parse --verify --quiet --end-of-options`),
    listedGit(13, `${git} config --show-scope --name-only --get-regexp ^(filter\\.|merge\\..*\\.driver$)`),
    listedGit(14, `${git} worktree add --detach --end-of-options`),
    listedGit(15, `${git} branch --end-of-options`),
    listedGit(16, `${git} switch --end-of-options`),
    listedGit(17, `${git} status --porcelain=v1 -z --untracked-files=all --ignore-submodules=all --`),
    listedGit(18, `${git} log -z --reverse --no-show-signature --no-color --format=%H%x20%s --end-of-options`),
    listedGit(
      19,
      `${git} diff --name-status -z -M --no-ext-diff --no-textconv --no-color --no-relative --end-of-options`,
    ),
    listedGit(20, `${git} check-ignore --quiet --end-of-options`),
    listedGit(21, `${git} ls-tree -z --name-only --end-of-options`),
    listedGit(22, `${git} ls-files -z --others --directory --end-of-options`),
    listedGit(23, `${git} --work-tree=. restore --worktree --source`),
    listedGit(24, `${git} merge-base --is-ancestor --end-of-options`),
    listedGit(25, `${git} worktree remove --end-of-options`),
    listedGit(26, `${git} branch -d --end-of-options`),
    listedGit(27, `${git} worktree add --end-of-options`),
    listedGit(
      28,
      `${committing} merge --no-ff --no-edit --no-stat --no-verify --no-gpg-sign --no-verify-signatures ` +
        "--no-autostash --no-rerere-autoupdate --end-of-options",
    ),
    listedGit(29, `${committing} merge --abort`),
    listedGit(30, `${git} add --all --`),
    listedGit(31, `${committing} commit --quiet --no-verify --no-gpg-sign --file=- --end-of-options`),
    listed(9, "npm run generate:check --"),
    listed(10, "npm run typecheck --"),
    listed(11, "npm run lint --"),
    listed(12, "npm run format:check --"),
    listed(13, "npm run deadcode --"),
    listed(14, "npm test -- --test-reporter=tap"),
    ["warning", "framework/limits.yaml", 1, "kernel_lines is N, over its ceiling of 4000."],
    ["warning", "framework/limits.yaml", 2, "adapter_lines is N, over its ceiling of 800."],
  ]);
  assert.equal(numberField(report, "errors"), 0);
  assert.equal(result.status, 0, result.stderr);
});
