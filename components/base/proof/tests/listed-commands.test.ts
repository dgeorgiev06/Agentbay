import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

const manifest = "components/base/proof/mode.yaml";

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

test("bay check on the kit warns once for each command the proof mode lists and once for its long step, and for nothing else", () => {
  assert.deepEqual(warningsOf(manifest), [
    [
      "warning",
      15,
      "Mode proof lists the command count-lines, which runs wc -l -- and which the mode says has the effects: read; " +
        "a listed command can run code the agent wrote.",
    ],
    [
      "warning",
      18,
      "Mode proof lists the command read-file, which runs cat -- and which the mode says has the effects: read; " +
        "a listed command can run code the agent wrote.",
    ],
    [
      "warning",
      21,
      "Mode proof lists the command bay, which runs ./bay.sh and which the mode says has the effects: read, write; " +
        "a listed command can run code the agent wrote.",
    ],
    [
      "warning",
      28,
      "Action prove of mode proof declares scriptTimeLimitSeconds: 1800, so each of its script steps may run " +
        "unattended for 1800 seconds, longer than the kernel's 480.",
    ],
  ]);
});
