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

function listedAt(line: number, command: string): readonly unknown[] {
  return [
    "warning",
    line,
    `Mode typescript lists the command ${command}; a listed command can run code the agent wrote.`,
  ];
}

test("bay check on the kit warns once for each command the typescript mode lists, and for nothing else", () => {
  assert.deepEqual(warningsOf(manifest), [
    listedAt(9, "npm run generate:check --"),
    listedAt(10, "npm run typecheck --"),
    listedAt(11, "npm run lint --"),
    listedAt(12, "npm run format:check --"),
    listedAt(13, "npm run deadcode --"),
    listedAt(14, "npm test -- --test-reporter=tap"),
  ]);
});
