import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

const manifest = "components/base/typescript/mode.yaml";

function fieldOf(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined;
}

function warningsOf(file: string): readonly (readonly unknown[])[] {
  const result = spawnSync(process.execPath, [join(kit, "bay", "cli.ts"), "check", "--json"], {
    cwd: kit,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    input: "",
    encoding: "utf8",
  });
  const findings: unknown = fieldOf(JSON.parse(result.stdout), "findings");
  const listed: readonly unknown[] = Array.isArray(findings) ? findings : [];
  return listed
    .filter((finding) => fieldOf(finding, "file") === file)
    .map((finding) => [fieldOf(finding, "severity"), fieldOf(finding, "line"), fieldOf(finding, "message")]);
}

const everyEffect = "read, write, network, spend, delete";

function listedAt(line: number, name: string, run: string): readonly unknown[] {
  return [
    "warning",
    line,
    `Mode typescript lists the command ${name}, which runs ${run} and which the mode says has the effects: ` +
      `${everyEffect}; a listed command can run code the agent wrote.`,
  ];
}

function longStepAt(line: number, action: string): readonly unknown[] {
  return [
    "warning",
    line,
    `Action ${action} of mode typescript declares scriptTimeLimitSeconds: 1030, so each of its script steps may run ` +
      "unattended for 1030 seconds, longer than the kernel's 480.",
  ];
}

test("bay check on the kit warns once for each command the typescript mode lists and each long step, and for nothing else", () => {
  assert.deepEqual(warningsOf(manifest), [
    listedAt(10, "check-generated-types", "npm run generate:check --"),
    listedAt(13, "check-types", "npm run typecheck --"),
    listedAt(16, "lint", "npm run lint --"),
    listedAt(19, "check-format", "npm run format:check --"),
    listedAt(22, "find-dead-code", "npm run deadcode --"),
    listedAt(25, "run-tests", "npm test -- --test-reporter=tap"),
    longStepAt(39, "check"),
    longStepAt(45, "test"),
  ]);
});
