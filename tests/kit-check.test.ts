import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fieldOf, numberField, parseJson, textField } from "../bay/json.ts";
import { listOf } from "./cli-fixture.ts";
import { testEnvironment } from "./kernel-fixture.ts";
import { kit } from "./project-fixture.ts";

test("the real bay check on the kit itself reports no errors and only the two size warnings", () => {
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
  assert.deepEqual(findings, [
    ["warning", "framework/limits.yaml", 1, "kernel_lines is N, over its ceiling of 4000."],
    ["warning", "framework/limits.yaml", 2, "adapter_lines is N, over its ceiling of 800."],
  ]);
  assert.equal(numberField(report, "errors"), 0);
  assert.equal(result.status, 0, result.stderr);
});
