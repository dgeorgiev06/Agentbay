import assert from "node:assert/strict";
import { test } from "node:test";
import type { ModeList } from "../bay/contracts.ts";
import { recordWithTrust } from "../bay/trust.ts";
import { checkFake, separate, separateFiles } from "./check-fixture.ts";
import { config, schemaText, yamlText } from "./system-fixture.ts";

const folder = "components/modes/go-toolchain";

const manifestFile = `${folder}/mode.yaml`;

const goManifest = [
  "name: go-toolchain",
  "version: 1.0.0",
  "description: Runs the go tool for a project written in Go.",
  "actions:",
  "  vet:",
  "    description: When the owner wants go vet run.",
  "    input: schemas/in.json",
  "    output: schemas/out.json",
  "    effects: [read]",
  "    run:",
  "      - script: scripts/vet.ts",
  "resources:",
  "  commandsStartWith: go",
  "  commands:",
  "    build: { run: build ./..., effects: [read, write] }",
  "    vet: { run: vet ./..., effects: [read] }",
  "  files:",
  "    throwaway: [.forge/go-cache/]",
  "",
].join("\n");

const goList: ModeList = {
  mode: "go-toolchain",
  commands: [
    { name: "build", words: ["go", "build", "./..."], effects: ["read", "write"] },
    { name: "vet", words: ["go", "vet", "./..."], effects: ["read"] },
  ],
  commandsStartWith: ["go"],
  throwaway: [".forge/go-cache"],
};

const vetScript = "export {};\n";

function goFiles(manifest: string): Record<string, string> {
  return {
    "agentbay.config.yaml": yamlText(config),
    [manifestFile]: manifest,
    [`${folder}/schemas/in.json`]: schemaText("in"),
    [`${folder}/schemas/out.json`]: schemaText("out"),
    [`${folder}/scripts/vet.ts`]: vetScript,
    [`${folder}/tests/vet.example.json`]: JSON.stringify({ input: {}, output: {} }),
  };
}

function recordFor(list: ModeList, scripts: Readonly<Record<string, string>>): string {
  const giving = { scripts, at: "2026-11-17T14:02:00.000Z", by: "owner at the terminal" };
  return recordWithTrust({ version: 1, modes: {} }, list, giving);
}

const scriptsOnTheDay = {
  "schemas/in.json": "efac523bd8e66013c0a8513269948c6ff1f126999c6cfc5545c47e88f15d2616",
  "schemas/out.json": "fc10e5dfc5fd4f294db6ff26fb8f505106118f3d9130f622a0b841e5d75251aa",
  "scripts/vet.ts": "0d73a05028df8331cd285684598d5d32f0ab709593574ddb02022b1df87220ae",
};

async function findingsOf(files: Readonly<Record<string, string>>): Promise<readonly unknown[]> {
  return (await checkFake(separateFiles(files), separate)).findings;
}

test("a project mode whose list was never trusted gets one warning with its counts and the command to type", async () => {
  assert.deepEqual(await findingsOf(goFiles(goManifest)), [
    {
      severity: "warning",
      file: manifestFile,
      path: "/resources",
      line: 13,
      message:
        "Mode go-toolchain lists 2 commands and 1 throwaway folder, and the owner does not trust the list of mode " +
        "go-toolchain, so none of it is granted.",
      fix: "The owner reads the list and decides: bay approve --trust go-toolchain",
    },
  ]);
});

const changedManifest = goManifest
  .replace("    build: { run: build ./..., effects: [read, write] }\n", "")
  .replace("    vet: { run: vet ./..., effects: [read] }", "    vet: { run: vet -all, effects: [read] }")
  .replace("  commands:\n", "  commands:\n    bench: { run: test -bench ., effects: [read, write] }\n")
  .replace("throwaway: [.forge/go-cache/]", "throwaway: [.forge/go-cache/, .forge/bench-cache/]");

test("a project mode whose list changed since the day of trust gets one warning that counts what changed", async () => {
  const files = { ...goFiles(changedManifest), ".agentbay/trust.json": recordFor(goList, scriptsOnTheDay) };
  assert.deepEqual(await findingsOf(files), [
    {
      severity: "warning",
      file: manifestFile,
      path: "/resources",
      line: 13,
      message:
        "The list of mode go-toolchain is not the list the owner trusted on 2026-11-17 (1 command added, 1 removed, " +
        "1 changed; 1 throwaway folder added), so none of it is granted.",
      fix: "The owner reads what changed and decides: bay approve --trust go-toolchain",
    },
  ]);
});

const withdrawFix =
  "Withdraw with bay approve --trust go-toolchain --reject unless the mode cannot work without the command. " +
  "The kernel believes the effects a mode lists and cannot check them.";

test("a trusted project mode gets one warning per command that says when and how it was trusted", async () => {
  const files = { ...goFiles(goManifest), ".agentbay/trust.json": recordFor(goList, scriptsOnTheDay) };
  assert.deepEqual(await findingsOf(files), [
    {
      severity: "warning",
      file: manifestFile,
      path: "/resources/commands/build",
      line: 15,
      message:
        "Mode go-toolchain, trusted on 2026-11-17 by the owner at the terminal, lists the command build, which runs " +
        "go build ./... and which the mode says has the effects: read, write; a listed command can run code the " +
        "agent wrote.",
      fix: withdrawFix,
    },
    {
      severity: "warning",
      file: manifestFile,
      path: "/resources/commands/vet",
      line: 16,
      message:
        "Mode go-toolchain, trusted on 2026-11-17 by the owner at the terminal, lists the command vet, which runs " +
        "go vet ./... and which the mode says has the effects: read; a listed command can run code the agent wrote.",
      fix: withdrawFix,
    },
  ]);
});

test("a trusted project mode whose script files changed gets one warning naming them, and the trust stands", async () => {
  const before = { ...scriptsOnTheDay, "scripts/old.ts": "a hash of a file that is gone" };
  const files = {
    ...goFiles(goManifest),
    [`${folder}/scripts/vet.ts`]: "export const changed = true;\n",
    [`${folder}/scripts/bench.ts`]: vetScript,
    ".agentbay/trust.json": recordFor(goList, before),
  };
  const findings = await findingsOf(files);
  assert.deepEqual(findings.slice(2), [
    {
      severity: "warning",
      file: manifestFile,
      path: "",
      line: 1,
      message:
        "3 script files of mode go-toolchain changed since the owner trusted its list on 2026-11-17: " +
        "scripts/bench.ts added, scripts/old.ts removed, scripts/vet.ts changed. The list did not change, so the " +
        "trust stands; the scripts choose the arguments of its commands.",
      fix: "Read the changes. To record that you have, decide again: bay approve --trust go-toolchain",
    },
  ]);
  assert.equal(findings.length, 3);
});

const unreadable = {
  severity: "error",
  file: ".agentbay/trust.json",
  path: "",
  message: "The trust record .agentbay/trust.json is not JSON, so no list it holds is granted.",
  fix: "Remove the file; then each mode outside the kit's components/base/ waits until the owner trusts it again.",
};

test("a trust record that cannot be read is one error, whether or not a project mode lists anything", async () => {
  const listing = { ...goFiles(goManifest), ".agentbay/trust.json": "{ version: 1" };
  assert.deepEqual(await findingsOf(listing), [unreadable]);
  const nothingListed = goManifest.slice(0, goManifest.indexOf("resources:"));
  const quiet = { ...goFiles(nothingListed), ".agentbay/trust.json": "{ version: 1" };
  assert.deepEqual(await findingsOf(quiet), [unreadable]);
});
