import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";
import {
  commandsRun,
  failingWith,
  hanging,
  listed,
  npmHeader,
  openToolchainProject,
  packageWith,
  printing,
  withoutSeconds,
  writeCheckout,
  type Fields,
  type Scripts,
} from "./checkouts.ts";

let project: ModeProject;

before(async () => {
  project = await openToolchainProject();
});

after(async () => {
  await project.close();
});

const names = ["generate:check", "typecheck", "lint", "format:check", "deadcode"];

function passingScripts(): Record<string, string> {
  return Object.fromEntries(names.map((name) => [name, printing(`${name} found nothing`)]));
}

function passed(name: string): object {
  const script = printing(`${name} found nothing`);
  return { name, verdict: "passed", stdout: `${npmHeader(name, script)}${name} found nothing\n`, stderr: "" };
}

async function checkoutWith(name: string, scripts: Scripts): Promise<string> {
  return writeCheckout(project, name, { "package.json": packageWith(scripts) });
}

async function verdicts(input: object): Promise<readonly Fields[]> {
  const output = await project.output("typescript.check", { timeLimitSeconds: 30, ...input });
  return listed(output, "verdicts").map((verdict) => withoutSeconds(verdict));
}

test("a type check that ends with exit code 2, as tsc does on a type error, is failed", async () => {
  const typecheck = failingWith("a.ts(1,7): error TS2322", 2);
  const folder = await checkoutWith("types-fail", { ...passingScripts(), typecheck });
  assert.deepEqual(await verdicts({ folder, checks: ["typecheck"] }), [
    {
      name: "typecheck",
      verdict: "failed",
      stdout: `${npmHeader("typecheck", typecheck)}a.ts(1,7): error TS2322\n`,
      stderr: "",
    },
  ]);
});

test("a check that ends with an exit code the mode does not recognise is inconclusive", async () => {
  const lint = failingWith("eslint could not read its configuration", 2);
  const folder = await checkoutWith("lint-crashes", { ...passingScripts(), lint });
  assert.deepEqual(await verdicts({ folder, checks: ["lint"] }), [
    {
      name: "lint",
      verdict: "inconclusive",
      reason: "lint ended with exit code 2, which the mode does not read as passed or failed.",
      stdout: `${npmHeader("lint", lint)}eslint could not read its configuration\n`,
      stderr: "",
    },
  ]);
});

function notSetUp(name: string, reason: string): object {
  return { name, verdict: "inconclusive", reason, stdout: "", stderr: "" };
}

const lintToAdd =
  'add "lint": "eslint ." to its scripts, or another command that lints the code and exits 1 on a finding';

test("a required check whose script the checkout lacks is inconclusive with what to add, and npm is not run for it", async () => {
  const scripts = Object.entries(passingScripts()).filter(([name]) => name !== "lint");
  const folder = await checkoutWith("no-lint", Object.fromEntries(scripts));
  const run = await project.run("typescript.check", { folder, checks: ["lint", "deadcode"] });
  assert.deepEqual(commandsRun(run.events), [
    ["cat", "--", "package.json"],
    ["npm", "run", "deadcode", "--"],
  ]);
  assert.ok(run.state.status === "done", JSON.stringify(run.state));
  assert.deepEqual(
    listed(run.state.output, "verdicts").map((verdict) => withoutSeconds(verdict)),
    [notSetUp("lint", `The checkout's package.json has no script lint: ${lintToAdd}.`), passed("deadcode")],
  );
});

test("generate:check runs only where the checkout has the script, and when named where it has not, it is inconclusive", async () => {
  const required = Object.entries(passingScripts()).filter(([name]) => name !== "generate:check");
  const folder = await checkoutWith("no-generate", Object.fromEntries(required));
  assert.deepEqual(await verdicts({ folder }), names.slice(1).map(passed));
  assert.deepEqual(await verdicts({ folder, checks: ["generate:check", "lint"] }), [
    notSetUp(
      "generate:check",
      "The checkout's package.json has no script generate:check, which only some projects have.",
    ),
    passed("lint"),
  ]);
  const withIt = await checkoutWith("with-generate", passingScripts());
  assert.deepEqual(await verdicts({ folder: withIt }), names.map(passed));
});

test("a checkout whose package.json is not JSON gives each required check an inconclusive verdict, runs no check and shows none of the file", async () => {
  const folder = await writeCheckout(project, "not-json", { "package.json": '{ "scripts": { "lint": "eslint ." ' });
  const run = await project.run("typescript.check", { folder });
  assert.deepEqual(commandsRun(run.events), [["cat", "--", "package.json"]]);
  assert.ok(run.state.status === "done", JSON.stringify(run.state));
  assert.deepEqual(
    listed(run.state.output, "verdicts").map((verdict) => withoutSeconds(verdict)),
    [
      notSetUp(
        "typecheck",
        "The checkout's package.json is not JSON, so the mode cannot tell whether it has the script typecheck: " +
          'make it JSON, with "typecheck": "tsc --noEmit" in its scripts, ' +
          "or another command that checks the types and exits 1 or 2 on a type error.",
      ),
      notSetUp(
        "lint",
        "The checkout's package.json is not JSON, so the mode cannot tell whether it has the script lint: " +
          'make it JSON, with "lint": "eslint ." in its scripts, or another command that lints the code and exits 1 on a finding.',
      ),
      notSetUp(
        "format:check",
        "The checkout's package.json is not JSON, so the mode cannot tell whether it has the script format:check: " +
          'make it JSON, with "format:check": "prettier --check ." in its scripts, ' +
          "or another command that checks the format and exits 1 on a finding.",
      ),
      notSetUp(
        "deadcode",
        "The checkout's package.json is not JSON, so the mode cannot tell whether it has the script deadcode: " +
          'make it JSON, with "deadcode": "knip" in its scripts, ' +
          "or another command that finds unused files and exports and exits 1 on a finding.",
      ),
    ],
  );
});

test("a checkout whose package.json has no scripts, or none at all, gives each required check what to add", async () => {
  const bare = await writeCheckout(project, "no-scripts", { "package.json": '{ "name": "checkout" }\n' });
  const [typecheck] = await verdicts({ folder: bare, checks: ["typecheck"] });
  assert.deepEqual(
    typecheck,
    notSetUp(
      "typecheck",
      'The checkout\'s package.json has no script typecheck: add "typecheck": "tsc --noEmit" to its scripts, ' +
        "or another command that checks the types and exits 1 or 2 on a type error.",
    ),
  );
  const empty = await writeCheckout(project, "no-package", { "src/two.ts": "export const two = 2;\n" });
  assert.deepEqual(await verdicts({ folder: empty, checks: ["lint"] }), [
    notSetUp(
      "lint",
      'The checkout has no package.json: add one with "lint": "eslint ." in its scripts, ' +
        "or another command that lints the code and exits 1 on a finding.",
    ),
  ]);
});

test("each check asked runs npm run with its name, in describe's order, and its output is npm's and the script's", async () => {
  const folder = await checkoutWith("subset", passingScripts());
  const run = await project.run("typescript.check", { folder, checks: ["lint", "typecheck"] });
  assert.deepEqual(commandsRun(run.events), [
    ["cat", "--", "package.json"],
    ["npm", "run", "typecheck", "--"],
    ["npm", "run", "lint", "--"],
  ]);
  assert.ok(run.state.status === "done", JSON.stringify(run.state));
  const verdicts = listed(run.state.output, "verdicts").map((verdict) => withoutSeconds(verdict));
  assert.deepEqual(verdicts, [passed("typecheck"), passed("lint")]);
});

test("the mode's sentences for a check name it does not have, a check stopped at its limit and a missing folder", async () => {
  const folder = await checkoutWith("reasons", { ...passingScripts(), typecheck: hanging });
  assert.equal(
    await project.failure("typescript.check", { folder, checks: ["lint", "spelling"] }),
    "There is no check named spelling. The checks are: generate:check, typecheck, lint, format:check, deadcode.",
  );
  const [stopped] = await verdicts({ folder, checks: ["typecheck"], timeLimitSeconds: 2 });
  assert.deepEqual(stopped, {
    name: "typecheck",
    verdict: "inconclusive",
    reason: "typecheck did not finish within 2 seconds and was stopped.",
    stdout: npmHeader("typecheck", hanging),
    stderr: "",
  });
  assert.deepEqual(await verdicts({ folder: "checkouts/nowhere", checks: ["lint"] }), [
    {
      name: "lint",
      verdict: "inconclusive",
      reason: "lint could not be started: The folder checkouts/nowhere does not exist.",
      stdout: "",
      stderr: "",
    },
  ]);
});
