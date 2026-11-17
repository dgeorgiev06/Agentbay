import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync } from "node:fs";
import { appendFile, copyFile, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { forgetfulStore, memoryStore, memoryStoreFiles, parrot, parrotFiles, type ModeFiles } from "./made-up-modes.ts";
import { kit } from "./project-fixture.ts";

type Ran = {
  readonly status: number | null;
  readonly stdout: string;
  readonly output: string;
};

const modesFolder = "components/modes";

const kitTestsThatReadTheKitsModes = ["tests/feature-map.test.ts", "tests/kit-check.test.ts", "tests/build.test.ts"];

const environment = { PATH: process.env.PATH ?? "/usr/bin:/bin" };

let copy: string;

let findingsBefore: readonly string[];

function ran(command: string, parameters: readonly string[]): Ran {
  const result = spawnSync(command, parameters, { cwd: copy, env: environment, input: "", encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, output: `${result.stdout}${result.stderr}` };
}

function git(...parameters: readonly string[]): string {
  const identity = ["-c", "user.name=isolation-test", "-c", "user.email=isolation-test@agentbay.invalid"];
  return execFileSync("git", [...identity, ...parameters], { cwd: copy, encoding: "utf8" });
}

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
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentbay-kit-copy-")));
  for (const file of kitFiles()) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await copyFile(join(kit, file), join(root, file));
  }
  await symlink(join(kit, "node_modules"), join(root, "node_modules"));
  return root;
}

async function addMode(name: string, files: ModeFiles): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    const file = join(copy, modesFolder, name, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, "utf8");
  }
}

function findings(): readonly string[] {
  const checked = ran(process.execPath, ["bay/cli.ts", "check", "--json"]);
  assert.equal(checked.status, 0, checked.output);
  const report: unknown = JSON.parse(checked.stdout);
  const listed: unknown = typeof report === "object" && report !== null ? Reflect.get(report, "findings") : undefined;
  assert.ok(Array.isArray(listed), checked.output);
  return listed.map((finding: unknown) => JSON.stringify(finding));
}

function newFindings(): readonly string[] {
  return findings().filter((finding) => !findingsBefore.includes(finding));
}

function changedPaths(): readonly string[] {
  return git("status", "--porcelain", "--untracked-files=all")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => line.slice(3));
}

function failedTests(output: string): readonly string[] {
  return [...output.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((match) => match[1] ?? "");
}

before(async () => {
  copy = await copyOfTheKit();
  git("init", "-q");
  await appendFile(join(copy, ".git/info/exclude"), "node_modules\n", "utf8");
  git("add", "-A");
  git("commit", "-q", "-m", "the kit as it is");
  findingsBefore = findings();
  await addMode(parrot, parrotFiles);
  await addMode(memoryStore, memoryStoreFiles(memoryStore, "keeps every item"));
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

test("adding a mode with one script action, and a mode that implements an interface, changes only their folders", () => {
  const added = changedPaths();
  assert.ok(added.length > 0);
  assert.deepEqual(
    added.filter(
      (path) => !path.startsWith(`${modesFolder}/${parrot}/`) && !path.startsWith(`${modesFolder}/${memoryStore}/`),
    ),
    [],
  );
});

test("bay check on the kit with the two modes added has the same findings as before", () => {
  assert.deepEqual(newFindings(), []);
});

test("the kit's tests that read its modes pass, and so do the added modes' own tests", () => {
  const modeTests = [parrot, memoryStore].map((name) => join(modesFolder, name, "tests", `${name}.test.ts`));
  const tested = ran(process.execPath, ["--test", ...kitTestsThatReadTheKitsModes, ...modeTests]);
  assert.deepEqual(failedTests(tested.output), []);
  assert.equal(tested.status, 0, tested.output);
  assert.deepEqual(
    changedPaths().filter((path) => !path.startsWith(`${modesFolder}/`)),
    [],
  );
});

test("the kit's type check and both dead-code runs accept the two modes", () => {
  const typed = ran(process.execPath, ["node_modules/typescript/bin/tsc", "--noEmit"]);
  assert.equal(typed.status, 0, typed.output);
  const knip = "node_modules/knip/bin/knip.js";
  for (const production of [[], ["--production"]]) {
    const unused = ran(process.execPath, [knip, "--config", "knip.json", "--no-config-hints", ...production]);
    assert.equal(unused.status, 0, unused.output);
  }
});

test("an items store that loses an item is accepted by bay check, and fails the shared test's first case", async () => {
  await addMode(forgetfulStore, memoryStoreFiles(forgetfulStore, "loses an item"));
  assert.deepEqual(newFindings(), []);
  const own = join(modesFolder, forgetfulStore, "tests", `${forgetfulStore}.test.ts`);
  const firstCase = "put then get returns the same items, in the order asked, and names the ids it does not hold";
  const tested = ran(process.execPath, ["--test", `--test-name-pattern=${firstCase}`, own]);
  assert.equal(tested.status, 1, tested.output);
  assert.deepEqual(failedTests(tested.output), [`items-store@1, ${forgetfulStore}: ${firstCase}`]);
});
