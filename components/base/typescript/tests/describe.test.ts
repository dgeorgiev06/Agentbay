import assert from "node:assert/strict";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";
import {
  commandsRun,
  listed,
  openToolchainProject,
  packageWith,
  printing,
  withoutSeconds,
  writeCheckout,
} from "./checkouts.ts";

let project: ModeProject;

const kitPackage = fileURLToPath(new URL("../../../../package.json", import.meta.url));

const language = {
  language: "TypeScript",
  sourceFiles: ["**/*.ts"],
  testFiles: ["**/*.test.ts"],
  practices: "practices.md",
};

const required = ["typecheck", "lint", "format:check", "deadcode"];

before(async () => {
  project = await openToolchainProject();
});

after(async () => {
  await project.close();
});

async function describedWith(packageText: string | undefined): Promise<unknown> {
  const file = join(project.root, "package.json");
  await (packageText === undefined ? rm(file, { force: true }) : writeFile(file, packageText, "utf8"));
  const run = await project.run("typescript.describe", {});
  assert.deepEqual(
    run.events.filter((event) => event.kind === "command"),
    [],
  );
  assert.ok(run.state.status === "done", JSON.stringify(run.state));
  return run.state.output;
}

test("describe in a project whose package.json is the kit's lists generate:check first, and every agreed script as present", async () => {
  assert.deepEqual(await describedWith(await readFile(kitPackage, "utf8")), {
    ...language,
    checks: ["generate:check", ...required],
    present: ["generate:check", ...required, "test"],
    missing: [],
  });
});

test("describe in a project with every required script and no generate:check lists four checks, all present", async () => {
  const scripts = Object.fromEntries([...required, "test"].map((name) => [name, "node --version"]));
  assert.deepEqual(await describedWith(packageWith(scripts)), {
    ...language,
    checks: required,
    present: [...required, "test"],
    missing: [],
  });
});

test("describe in a project that lacks lint and test names both as missing, each with what to add", async () => {
  const scripts = { typecheck: "tsc --noEmit", "format:check": "prettier --check .", deadcode: "knip" };
  assert.deepEqual(await describedWith(packageWith(scripts)), {
    ...language,
    checks: required,
    present: ["typecheck", "format:check", "deadcode"],
    missing: [
      {
        name: "lint",
        reason:
          'The project\'s package.json has no script lint: add "lint": "eslint ." to its scripts, ' +
          "or another command that lints the code and exits 1 on a finding.",
      },
      {
        name: "test",
        reason:
          'The project\'s package.json has no script test: add "test": "node --test" to its scripts, ' +
          "or another command that runs the tests with node's test runner.",
      },
    ],
  });
});

test("describe in a project with no package.json, or one that is not JSON, says every required script is missing and why", async () => {
  const none = await describedWith(undefined);
  assert.deepEqual(none, {
    ...language,
    checks: required,
    present: [],
    missing: [
      {
        name: "typecheck",
        reason:
          'The project has no package.json: add one with "typecheck": "tsc --noEmit" in its scripts, ' +
          "or another command that checks the types and exits 1 or 2 on a type error.",
      },
      {
        name: "lint",
        reason:
          'The project has no package.json: add one with "lint": "eslint ." in its scripts, ' +
          "or another command that lints the code and exits 1 on a finding.",
      },
      {
        name: "format:check",
        reason:
          'The project has no package.json: add one with "format:check": "prettier --check ." in its scripts, ' +
          "or another command that checks the format and exits 1 on a finding.",
      },
      {
        name: "deadcode",
        reason:
          'The project has no package.json: add one with "deadcode": "knip" in its scripts, ' +
          "or another command that finds unused files and exports and exits 1 on a finding.",
      },
      {
        name: "test",
        reason:
          'The project has no package.json: add one with "test": "node --test" in its scripts, ' +
          "or another command that runs the tests with node's test runner.",
      },
    ],
  });
  const broken = await describedWith('{ "scripts": { "lint": "eslint ." ');
  assert.deepEqual(broken, {
    ...language,
    checks: required,
    present: [],
    missing: [...required, "test"].map((name) => ({ name, reason: notJson(name) })),
  });
});

function notJson(name: string): string {
  const additions: Readonly<Record<string, string>> = {
    typecheck:
      '"typecheck": "tsc --noEmit" in its scripts, or another command that checks the types and exits 1 or 2 on a type error',
    lint: '"lint": "eslint ." in its scripts, or another command that lints the code and exits 1 on a finding',
    "format:check":
      '"format:check": "prettier --check ." in its scripts, or another command that checks the format and exits 1 on a finding',
    deadcode:
      '"deadcode": "knip" in its scripts, or another command that finds unused files and exports and exits 1 on a finding',
    test: '"test": "node --test" in its scripts, or another command that runs the tests with node\'s test runner',
  };
  return (
    `The project's package.json is not JSON, so the mode cannot tell whether it has the script ${name}: ` +
    `make it JSON, with ${additions[name] ?? ""}.`
  );
}

const oddScripts = `${JSON.stringify(
  {
    name: "checkout",
    private: true,
    type: "module",
    scripts: {
      typecheck: "   ",
      lint: null,
      "format:check": printing("format:check found nothing"),
      deadcode: printing("deadcode found nothing"),
      test: { run: "node --test" },
    },
  },
  null,
  2,
)}\n`;

function lacksScript(owner: string, name: string, addition: string): string {
  return `${owner}'s package.json has no script ${name}: add ${addition}.`;
}

const typecheckAddition =
  '"typecheck": "tsc --noEmit" to its scripts, or another command that checks the types and exits 1 or 2 on a type error';

const lintAddition =
  '"lint": "eslint ." to its scripts, or another command that lints the code and exits 1 on a finding';

const testAddition =
  '"test": "node --test" to its scripts, or another command that runs the tests with node\'s test runner';

test("a script that is blank, null or a mapping is not set up: describe lists it as missing, and check and test run no npm for it", async () => {
  assert.deepEqual(await describedWith(oddScripts), {
    ...language,
    checks: required,
    present: ["format:check", "deadcode"],
    missing: [
      { name: "typecheck", reason: lacksScript("The project", "typecheck", typecheckAddition) },
      { name: "lint", reason: lacksScript("The project", "lint", lintAddition) },
      { name: "test", reason: lacksScript("The project", "test", testAddition) },
    ],
  });
  const folder = await writeCheckout(project, "odd-scripts", { "package.json": oddScripts });
  const checked = await project.run("typescript.check", { folder, checks: ["typecheck", "lint"] });
  const tested = await project.run("typescript.test", { folder });
  assert.ok(checked.state.status === "done" && tested.state.status === "done", JSON.stringify([checked, tested]));
  assert.deepEqual(
    {
      commands: [...commandsRun(checked.events), ...commandsRun(tested.events)],
      verdicts: listed(checked.state.output, "verdicts").map((verdict) => withoutSeconds(verdict)),
      test: withoutSeconds(tested.state.output),
    },
    {
      commands: [
        ["cat", "--", "package.json"],
        ["cat", "--", "package.json"],
      ],
      verdicts: [
        {
          name: "typecheck",
          verdict: "inconclusive",
          reason: lacksScript("The checkout", "typecheck", typecheckAddition),
          stdout: "",
          stderr: "",
        },
        {
          name: "lint",
          verdict: "inconclusive",
          reason: lacksScript("The checkout", "lint", lintAddition),
          stdout: "",
          stderr: "",
        },
      ],
      test: {
        verdict: "inconclusive",
        reason: lacksScript("The checkout", "test", testAddition),
        stdout: "",
        stderr: "",
      },
    },
  );
});
