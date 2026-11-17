import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

const manifest = "components/base/git-worktrees/mode.yaml";

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function warningsOf(file: string): readonly (readonly unknown[])[] {
  const result = spawnSync(process.execPath, [join(kit, "bay", "cli.ts"), "check", "--json"], {
    cwd: kit,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    input: "",
    encoding: "utf8",
  });
  const findings: unknown = fieldOf(JSON.parse(result.stdout), "findings");
  const listed: readonly unknown[] = Array.isArray(findings) ? findings : [];
  return listed
    .filter((finding) => fieldOf(finding, "file") === file)
    .map((finding) => [fieldOf(finding, "severity"), fieldOf(finding, "line"), fieldOf(finding, "message")]);
}

function listedAt(line: number, command: string): readonly unknown[] {
  return [
    "warning",
    line,
    `Mode git-worktrees lists the command ${command}; a listed command can run code the agent wrote.`,
  ];
}

const unattributed = "git -c core.hooksPath=/dev/null -c core.fsmonitor=false -c submodule.recurse=false";

const git = `${unattributed} --attr-source=4b825dc642cb6eb9a060e54bf8d69288fbee4904`;

const committing = `${git} -c user.name=agentbay-git-worktrees -c user.email=git-worktrees@agentbay.invalid -c gc.auto=0`;

test("bay check on the kit warns once for each command the git-worktrees mode lists, and for nothing else", () => {
  assert.deepEqual(warningsOf(manifest), [
    listedAt(12, `${git} rev-parse --verify --quiet --end-of-options`),
    listedAt(13, `${git} config --show-scope --name-only --get-regexp ^(filter\\.|merge\\..*\\.driver$)`),
    listedAt(14, `${git} worktree add --detach --end-of-options`),
    listedAt(15, `${git} branch --end-of-options`),
    listedAt(16, `${git} switch --end-of-options`),
    listedAt(17, `${git} status --porcelain=v1 -z --untracked-files=all --ignore-submodules=all --`),
    listedAt(18, `${git} log -z --reverse --no-show-signature --no-color --format=%H%x20%s --end-of-options`),
    listedAt(
      19,
      `${git} diff --name-status -z -M --no-ext-diff --no-textconv --no-color --no-relative --end-of-options`,
    ),
    listedAt(20, `${git} check-ignore --quiet --end-of-options`),
    listedAt(21, `${git} ls-tree -z --name-only --end-of-options`),
    listedAt(22, `${git} ls-files -z --others --directory --end-of-options`),
    listedAt(23, `${git} --work-tree=. restore --worktree --source`),
    listedAt(24, `${git} merge-base --is-ancestor --end-of-options`),
    listedAt(25, `${git} worktree remove --end-of-options`),
    listedAt(26, `${git} branch -d --end-of-options`),
    listedAt(27, `${git} worktree add --end-of-options`),
    listedAt(
      28,
      `${committing} merge --no-ff --no-edit --no-stat --no-verify --no-gpg-sign --no-verify-signatures ` +
        "--no-autostash --no-rerere-autoupdate --end-of-options",
    ),
    listedAt(29, `${committing} merge --abort`),
    listedAt(30, `${git} add --all --`),
    listedAt(31, `${committing} commit --quiet --no-verify --no-gpg-sign --file=- --end-of-options`),
    listedAt(32, `${unattributed} --work-tree=. check-attr -z filter --`),
    listedAt(33, `${unattributed} --work-tree=. apply --end-of-options`),
  ]);
});
