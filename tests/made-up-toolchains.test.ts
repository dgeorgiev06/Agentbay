import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { tally, tallyFiles, wrongTally, type ModeFiles } from "./made-up-toolchains.ts";
import { kit } from "./project-fixture.ts";

type Ran = {
  readonly status: number | null;
  readonly output: string;
};

const baseFolder = "components/base";

const environment = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

let copy: string;

function kitFiles(): readonly string[] {
  const listed = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], {
    cwd: kit,
    encoding: "utf8",
  });
  return listed
    .split("\0")
    .filter((file) => file !== "" && existsSync(join(kit, file)) && !lstatSync(join(kit, file)).isSymbolicLink());
}

async function copyOfTheKit(): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentbay-toolchains-")));
  for (const file of kitFiles()) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await copyFile(join(kit, file), join(root, file));
  }
  await symlink(join(kit, "node_modules"), join(root, "node_modules"));
  return root;
}

async function addBaseMode(name: string, files: ModeFiles): Promise<void> {
  assert.equal(existsSync(join(copy, baseFolder, name)), false, `the kit already holds ${baseFolder}/${name}`);
  for (const [path, text] of Object.entries(files)) {
    const file = join(copy, baseFolder, name, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, "utf8");
  }
}

function modeTestRan(name: string): Ran {
  const file = join(baseFolder, name, "tests", `${name}.test.ts`);
  const result = spawnSync(process.execPath, ["--test", file], { cwd: copy, env: environment, encoding: "utf8" });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

function failedTests(output: string): readonly string[] {
  return [...output.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((match) => match[1] ?? "");
}

before(async () => {
  copy = await copyOfTheKit();
  await addBaseMode(tally, tallyFiles(tally, "stops a check at its limit"));
  await addBaseMode(wrongTally, tallyFiles(wrongTally, "passes a check stopped at its limit"));
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

test("a made-up toolchain for another language, whose checks are listed commands, passes toolchain@1's shared test", () => {
  const tested = modeTestRan(tally);
  assert.deepEqual(failedTests(tested.output), []);
  assert.equal(tested.status, 0, tested.output);
  assert.match(tested.output, /^# pass 15$/m);
});

test("a made-up toolchain that reports passed for a check stopped at its limit fails the shared test's case on it", () => {
  const tested = modeTestRan(wrongTally);
  assert.equal(tested.status, 1, tested.output);
  assert.deepEqual(failedTests(tested.output), [
    `toolchain@1, ${wrongTally}: a check that does not end within its time limit is stopped and inconclusive, ` +
      "its time is reported, and the checks after it still run",
  ]);
});
