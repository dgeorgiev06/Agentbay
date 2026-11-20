import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

const manifest = "components/base/forge/mode.yaml";

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

test("bay check on the kit warns for forge's three long steps, the final proof, a wave slice's own proof and the wave's checks, and for nothing else", () => {
  assert.deepEqual(warningsOf(manifest), [
    [
      "warning",
      134,
      "Action final-proof of mode forge declares scriptTimeLimitSeconds: 1800, so each of its script steps may run " +
        "unattended for 1800 seconds, longer than the kernel's 480.",
    ],
    [
      "warning",
      193,
      "Action slice-proof of mode forge declares scriptTimeLimitSeconds: 1800, so each of its script steps may run " +
        "unattended for 1800 seconds, longer than the kernel's 480.",
    ],
    [
      "warning",
      216,
      "Action prove-checks of mode forge declares scriptTimeLimitSeconds: 3600, so each of its script steps may run " +
        "unattended for 3600 seconds, longer than the kernel's 480.",
    ],
  ]);
});
