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

test("a check whose script the checkout does not have cannot be started and is inconclusive", async () => {
  const scripts = Object.entries(passingScripts()).filter(([name]) => name !== "lint");
  const folder = await checkoutWith("no-lint", Object.fromEntries(scripts));
  const [lint, deadcode] = await verdicts({ folder, checks: ["lint", "deadcode"] });
  assert.match(typeof lint?.stderr === "string" ? lint.stderr : "", /^npm error Missing script: "lint"\n/);
  assert.deepEqual(
    { ...lint, stderr: "npm's message" },
    {
      name: "lint",
      verdict: "inconclusive",
      reason: "The checkout's package.json has no script lint, so it could not be started.",
      stdout: "",
      stderr: "npm's message",
    },
  );
  assert.deepEqual(deadcode, passed("deadcode"));
});

test("each check asked runs npm run with its name, in describe's order, and its output is npm's and the script's", async () => {
  const folder = await checkoutWith("subset", passingScripts());
  const run = await project.run("typescript.check", { folder, checks: ["lint", "typecheck"] });
  assert.deepEqual(commandsRun(run.events), [
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
