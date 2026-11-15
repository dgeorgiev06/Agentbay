import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { check, cleanFiles, findFinding, limitsText, withoutFinding } from "./check-fixture.ts";
import { kit } from "./project-fixture.ts";

const limitsFile = "framework/limits.yaml";

async function realCommandTable(): Promise<string> {
  return readFile(join(kit, "bay", "commands.ts"), "utf8");
}

test("cli_commands counts the entries of the command table in bay/commands.ts", async () => {
  const table = await realCommandTable();
  const lowered = limitsText.replace(/cli_commands: \d+/, "cli_commands: 11");
  const over = await check({ ...cleanFiles(), "bay/commands.ts": table, [limitsFile]: lowered });
  const finding = findFinding(over, limitsFile, "cli_commands is 12, over its ceiling of 11.");
  assert.equal(finding.severity, "warning");
  const atCeiling = limitsText.replace(/cli_commands: \d+/, "cli_commands: 12");
  withoutFinding(await check({ ...cleanFiles(), "bay/commands.ts": table, [limitsFile]: atCeiling }), "cli_commands");
});

test("cli_commands is 0 without a command table, so a project without the kernel is not charged", async () => {
  const report = await check({
    ...cleanFiles(),
    [limitsFile]: limitsText.replace(/cli_commands: \d+/, "cli_commands: 0"),
  });
  withoutFinding(report, "cli_commands");
});
