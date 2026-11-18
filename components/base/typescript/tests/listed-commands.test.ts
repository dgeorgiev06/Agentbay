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

function listedAt(
  line: number,
  name: string,
  listing: { readonly run: string; readonly effects?: string },
): readonly unknown[] {
  return [
    "warning",
    line,
    `Mode typescript lists the command ${name}, which runs ${listing.run} and which the mode says has the effects: ` +
      `${listing.effects ?? everyEffect}; a listed command can run code the agent wrote.`,
  ];
}

test("bay check on the kit warns once for each command the typescript mode lists, and for nothing else", () => {
  assert.deepEqual(warningsOf(manifest), [
    listedAt(12, "read-package", { run: "cat -- package.json", effects: "read" }),
    listedAt(15, "check-generated-types", { run: "npm run generate:check --" }),
    listedAt(18, "check-types", { run: "npm run typecheck --" }),
    listedAt(21, "lint", { run: "npm run lint --" }),
    listedAt(24, "check-format", { run: "npm run format:check --" }),
    listedAt(27, "find-dead-code", { run: "npm run deadcode --" }),
    listedAt(30, "run-tests", { run: "npm test -- --test-reporter=tap" }),
  ]);
});
