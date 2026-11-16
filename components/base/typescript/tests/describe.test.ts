import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openModeProject, type ModeProject } from "../../../../tests/mode-harness.ts";

let project: ModeProject;

before(async () => {
  project = await openModeProject({ bindings: {}, adapter: "claude-code", modes: ["typescript"] });
});

after(async () => {
  await project.close();
});

test("describe names the language, its source and test files, its practices file and its checks", async () => {
  assert.deepEqual(await project.output("typescript.describe", {}), {
    language: "TypeScript",
    sourceFiles: ["**/*.ts"],
    testFiles: ["**/*.test.ts"],
    practices: "components/base/typescript/practices.md",
    checks: ["generate:check", "typecheck", "lint", "format:check", "deadcode"],
  });
});
