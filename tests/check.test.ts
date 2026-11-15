import assert from "node:assert/strict";
import { test } from "node:test";
import { summarizeCheck, type CheckReport } from "../bay/check.ts";
import {
  assertClean,
  check,
  cleanFiles,
  findFinding,
  notesSkillFile,
  skillSections,
  skillText,
} from "./check-fixture.ts";
import { notesMode, paths, storeMode, yamlText } from "./system-fixture.ts";

test("a valid system with complete skills, examples and limits passes with no findings", async () => {
  const report = await check(cleanFiles());
  assertClean(report);
  assert.equal(report.errors, 0);
  assert.equal(report.warnings, 0);
});

test("registry problems, skill problems and layout problems are all reported at once", async () => {
  const report = await check({
    ...cleanFiles(),
    [paths.notes]: `${yamlText(notesMode)}colour: blue\n`,
    [notesSkillFile]: skillText([skillSections.input]),
    "components/base/store/playbook.md": "old",
  });
  const registry = findFinding(report, paths.notes, "has the field colour, which is not allowed here");
  assert.equal(registry.severity, "error");
  findFinding(report, "components/base/store/playbook.md", "holds playbook.md");
  assert.ok(report.errors >= 2);
});

test("a listed command in a base mode is a warning", async () => {
  const manifest = yamlText({ ...storeMode, resources: { commands: ["node --test"] } });
  const report = await check({ ...cleanFiles(), [paths.store]: manifest });
  const finding = findFinding(
    report,
    paths.store,
    "Mode store lists the command node --test; a listed command can run code the agent wrote.",
  );
  assert.equal(finding.severity, "warning");
  assert.equal(finding.path, "/resources/commands/0");
  assert.equal(report.errors, 0);
});

test("a listed command in a mode outside components/base is an error", async () => {
  const manifest = yamlText({ ...notesMode, resources: { commands: ["git status"] } });
  const report = await check({ ...cleanFiles(), [paths.notes]: manifest });
  const finding = findFinding(report, paths.notes, "Mode notes lists the command git status");
  assert.equal(finding.severity, "error");
  assert.match(finding.message, /Only a mode under components\/base\/ may list commands\./);
});

test("the summary groups findings by file, errors first, each with its fix, and ends with the counts", () => {
  const report: CheckReport = {
    findings: [
      { file: "b.yaml", path: "", line: 4, message: "B warns.", fix: "Fix B.", severity: "warning" },
      { file: "c.yaml", path: "", message: "C warns.", severity: "warning" },
      { file: "b.yaml", path: "", line: 9, message: "B fails.", fix: "Fix B again.", severity: "error" },
      { file: "a.yaml", path: "", line: 2, message: "A fails.", fix: "Fix A.", severity: "error" },
    ],
    errors: 2,
    warnings: 2,
  };
  assert.equal(
    summarizeCheck(report),
    [
      "a.yaml:2: error: A fails.",
      "  fix: Fix A.",
      "b.yaml:9: error: B fails.",
      "  fix: Fix B again.",
      "b.yaml:4: warning: B warns.",
      "  fix: Fix B.",
      "c.yaml: warning: C warns.",
      "bay check: 2 errors, 2 warnings.",
    ].join("\n"),
  );
});

test("the summary of a clean report is only the counts", () => {
  assert.equal(summarizeCheck({ findings: [], errors: 0, warnings: 0 }), "bay check: 0 errors, 0 warnings.");
  const one: CheckReport = {
    findings: [{ file: "a.yaml", path: "", message: "A.", severity: "error" }],
    errors: 1,
    warnings: 0,
  };
  assert.match(summarizeCheck(one), /bay check: 1 error, 0 warnings\.$/);
});
