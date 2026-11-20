import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { copyOfTheKit } from "./kit-copy.ts";
import { kit } from "./project-fixture.ts";

type Checked = {
  readonly status: number | null;
  readonly errors: unknown;
  readonly warnings: unknown;
  readonly errorFiles: readonly unknown[];
};

const fixtures = join(kit, "tests", "fixtures");

const madeFolders: string[] = [];

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function checked(where: { readonly kit: string; readonly project: string }): Checked {
  const { project } = where;
  const result = spawnSync(
    process.execPath,
    [join(where.kit, "bay", "cli.ts"), "check", "--project", project, "--json"],
    {
      cwd: project,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      input: "",
      encoding: "utf8",
    },
  );
  const report: unknown = JSON.parse(result.stdout);
  const findings = fieldOf(report, "findings");
  const listed: readonly unknown[] = Array.isArray(findings) ? findings : [];
  return {
    status: result.status,
    errors: fieldOf(report, "errors"),
    warnings: fieldOf(report, "warnings"),
    errorFiles: listed
      .filter((finding) => fieldOf(finding, "severity") === "error")
      .map((finding) => fieldOf(finding, "file")),
  };
}

async function soundProjectWith(overlay: string | undefined): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), "agentbay-fixture-")));
  madeFolders.push(folder);
  await cp(join(fixtures, "sound"), folder, { recursive: true });
  if (overlay !== undefined) {
    await cp(join(fixtures, overlay), folder, { recursive: true });
  }
  spawnSync("git", ["init", "-q"], { cwd: folder });
  return folder;
}

after(async () => {
  for (const folder of madeFolders) {
    await rm(folder, { recursive: true, force: true });
  }
});

test("the sound fixture is a project that bay check finds no error or warning in", async () => {
  const { status, errors, warnings } = checked({ kit, project: await soundProjectWith(undefined) });
  assert.deepEqual({ status, errors, warnings }, { status: 0, errors: 0, warnings: 0 });
});

test("the sound fixture with broken-overlay over it fails bay check with 67 errors; the forge it lists brings proof, git-worktrees and requirements and no toolchain", async () => {
  const { status, errors, warnings } = checked({ kit, project: await soundProjectWith("broken-overlay") });
  assert.deepEqual({ status, errors, warnings }, { status: 1, errors: 67, warnings: 38 });
});

test("the sound fixture with grants-overlay over it fails bay check with one error, in the mode grantbad", async () => {
  const { status, errors, warnings, errorFiles } = checked({ kit, project: await soundProjectWith("grants-overlay") });
  assert.deepEqual(
    { status, errors, warnings, errorFiles },
    { status: 1, errors: 1, warnings: 1, errorFiles: ["components/modes/grantbad/mode.yaml"] },
  );
});

test("a copy of the kit with kit-overlay over it fails bay check with six errors, one per file the overlay adds", async () => {
  const copy = await copyOfTheKit("fixture-kit");
  madeFolders.push(copy);
  await cp(join(fixtures, "kit-overlay"), copy, { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: copy });
  const { status, errors, errorFiles } = checked({ kit: copy, project: copy });
  assert.deepEqual(
    { status, errors, errorFiles },
    {
      status: 1,
      errors: 6,
      errorFiles: [
        "components/modes/zz-broken/mode.yaml",
        "components/stray",
        "components/base/interfaces/notes.md",
        "components/base/interfaces/zz/x.txt",
        "bay/zz-a.ts",
        "bay/zz-c.ts",
      ],
    },
  );
});
