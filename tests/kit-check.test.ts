import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, numberField, parseJson, textField } from "../bay/json.ts";
import { listOf } from "./cli-fixture.ts";
import { testEnvironment } from "./kernel-fixture.ts";
import { copyOfTheKit } from "./test-toolbox.ts";
import { kit } from "./project-fixture.ts";

type Finding = {
  readonly severity: string | undefined;
  readonly file: string | undefined;
  readonly line: number | undefined;
  readonly message: string;
};

const sizeWarnings: readonly Finding[] = [
  {
    severity: "warning",
    file: "framework/limits.yaml",
    line: 1,
    message: "kernel_lines is N, over its ceiling of 4000.",
  },
  {
    severity: "warning",
    file: "framework/limits.yaml",
    line: 2,
    message: "adapter_lines is N, over its ceiling of 800.",
  },
];

const listedCommand = /^Mode ([a-z0-9-]+) lists the command .+; a listed command can run code the agent wrote\.$/;

const longStep = /^Action [a-z0-9-]+ of mode ([a-z0-9-]+) declares scriptTimeLimitSeconds: \d+, .+$/;

const listedCommandsTest = "tests/listed-commands.test.ts";

let copy: string;

before(async () => {
  copy = await copyOfTheKit("kit-check");
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

function findingOf(finding: Json): Finding {
  return {
    severity: textField(finding, "severity"),
    file: textField(finding, "file"),
    line: numberField(finding, "line"),
    message: (textField(finding, "message") ?? "").replace(/ is \d+,/, " is N,"),
  };
}

function listingModeFolder(finding: Finding): string | undefined {
  const mode = (listedCommand.exec(finding.message) ?? longStep.exec(finding.message))?.[1];
  const file = finding.file ?? "";
  const folder = dirname(file);
  const inModeFolder = /^components\/[a-z]+\/[a-z0-9-]+\/mode\.yaml$/.test(file) && folder.endsWith(`/${mode ?? ""}`);
  return finding.severity === "warning" && mode !== undefined && inModeFolder ? folder : undefined;
}

function isSizeWarning(finding: Finding): boolean {
  return sizeWarnings.some((size) => JSON.stringify(size) === JSON.stringify(finding));
}

function isOwnersSetting(finding: Finding): boolean {
  return (
    finding.severity === "warning" &&
    finding.file === "agentbay.config.yaml" &&
    finding.message.startsWith("Skill steps run without the hook")
  );
}

function kitCheck(): { readonly status: number | null; readonly stderr: string; readonly report: Json } {
  const result = spawnSync(process.execPath, [join(copy, "bay", "cli.ts"), "check", "--json"], {
    cwd: copy,
    env: testEnvironment,
    input: "",
    encoding: "utf8",
  });
  return { status: result.status, stderr: result.stderr, report: parseJson(result.stdout) };
}

test("a finding is a size warning, or a listed command or a long step of the mode whose mode.yaml it names, and nothing else is", () => {
  const listed = (file: string, message: string): Finding => ({ severity: "warning", file, line: 9, message });
  const sentence = (mode: string): string =>
    `Mode ${mode} lists the command tests, which runs npm test -- and which the mode says has the effects: read; ` +
    "a listed command can run code the agent wrote.";
  assert.equal(
    listingModeFolder(listed("components/base/notes/mode.yaml", sentence("notes"))),
    "components/base/notes",
  );
  assert.equal(listingModeFolder(listed("components/base/notes/mode.yaml", sentence("journal"))), undefined);
  assert.equal(listingModeFolder(listed("framework/limits.yaml", sentence("notes"))), undefined);
  assert.equal(
    listingModeFolder({ ...listed("components/base/notes/mode.yaml", sentence("notes")), severity: "error" }),
    undefined,
  );
  assert.equal(listingModeFolder(listed("components/base/notes/mode.yaml", "Mode notes has no README.md.")), undefined);
  const longStepOf = (mode: string): string =>
    `Action check of mode ${mode} declares scriptTimeLimitSeconds: 1030, so each of its script steps may run ` +
    "unattended for 1030 seconds, longer than the kernel's 480.";
  assert.equal(
    listingModeFolder(listed("components/base/notes/mode.yaml", longStepOf("notes"))),
    "components/base/notes",
  );
  assert.equal(listingModeFolder(listed("components/base/notes/mode.yaml", longStepOf("journal"))), undefined);
  const kernelLines = "kernel_lines is N, over its ceiling of 4000.";
  assert.equal(
    isSizeWarning({ severity: "warning", file: "framework/limits.yaml", line: 1, message: kernelLines }),
    true,
  );
  assert.equal(isSizeWarning({ severity: "warning", file: "framework/limits.yaml", line: 3, message: "x" }), false);
});

test("the real bay check on the kit itself reports no errors, and warns only of size, of listed commands and of long steps", () => {
  const { status, stderr, report } = kitCheck();
  const findings = listOf(fieldOf(report, "findings")).map(findingOf);
  assert.ok(Array.isArray(fieldOf(report, "findings")), JSON.stringify(report));
  assert.deepEqual(
    findings.filter(
      (finding) => !isSizeWarning(finding) && !isOwnersSetting(finding) && listingModeFolder(finding) === undefined,
    ),
    [],
  );
  assert.equal(numberField(report, "errors"), 0);
  assert.equal(status, 0, stderr);
});

test("every mode of the kit that lists a command has its own test of the warnings bay check gives for it", () => {
  const findings = listOf(fieldOf(kitCheck().report, "findings")).map(findingOf);
  const folders = [...new Set(findings.flatMap((finding) => listingModeFolder(finding) ?? []))];
  assert.deepEqual(
    folders.filter((folder) => !existsSync(join(kit, folder, listedCommandsTest))),
    [],
  );
});
