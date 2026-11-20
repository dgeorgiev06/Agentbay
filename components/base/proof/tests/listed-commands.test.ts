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
      24,
      "Mode proof lists the command count-matches, which runs grep -r -c -h -F -e and which the mode says has the " +
        "effects: read; a listed command can run code the agent wrote.",
    ],
    [
      "warning",
      31,
      "Action prove of mode proof declares scriptTimeLimitSeconds: 7200, so each of its script steps may run " +
        "unattended for 7200 seconds, longer than the kernel's 480.",
    ],
  ]);
});

test("bay config on the kit lists proof's two time settings with the kit's values", () => {
  const result = spawnSync(process.execPath, [join(kit, "bay", "cli.ts"), "config", "--json"], {
    cwd: kit,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    input: "",
    encoding: "utf8",
  });
  const settings: unknown = fieldOf(JSON.parse(result.stdout), "settings");
  const listed: readonly unknown[] = Array.isArray(settings) ? settings : [];
  const timeSettings = listed
    .filter((setting) => /^settings\.proof\.[a-zA-Z]+Seconds$/.test(String(fieldOf(setting, "name"))))
    .map((setting) => [fieldOf(setting, "name"), fieldOf(setting, "type"), fieldOf(setting, "current")]);
  assert.deepEqual(timeSettings, [
    ["settings.proof.stepSeconds", "integer", 3600],
    ["settings.proof.longestCallSeconds", "integer", 2400],
  ]);
});
