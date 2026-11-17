import assert from "node:assert/strict";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { Effect, ModeList } from "../bay/contracts.ts";
import { fieldOf, toJson } from "../bay/json.ts";
import { layoutOf } from "../bay/layout.ts";
import { nodeFileSystem } from "../bay/node-ports.ts";
import { readTrustRecord, recordWithoutTrust } from "../bay/trust.ts";
import { bay, listOf } from "./cli-fixture.ts";
import { makeCommandKit, secretName, type CommandKit } from "./commands-fixture.ts";
import { kit } from "./project-fixture.ts";
import { trustRecordFileOf, trustRecordFiles } from "./system-fixture.ts";

const everyEffect: readonly Effect[] = ["read", "write", "network", "spend", "delete"];

const leavingCode = "require('node:fs').writeFileSync('left.txt','x')";

const list: ModeList = {
  mode: "command-prober",
  commands: [{ name: "leave", words: ["node", "-e", leavingCode], effects: everyEffect }],
  commandsStartWith: [],
  throwaway: [],
};

async function writeFiles(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, "utf8");
  }
}

async function withdrawTrust(project: CommandKit): Promise<void> {
  const record = await readTrustRecord(nodeFileSystem, layoutOf({ kit, project: project.root }));
  assert.ok(record.ok, JSON.stringify(record));
  await writeFiles(project.root, trustRecordFileOf(recordWithoutTrust(record.value, list.mode)));
}

async function leftFile(project: CommandKit): Promise<boolean> {
  try {
    await stat(join(project.root, "left.txt"));
    return true;
  } catch {
    return false;
  }
}

async function firstAnswer(project: CommandKit): Promise<unknown> {
  const input = { requests: [{ name: "leave", arguments: [], folder: ".", timeLimitSeconds: 30 }], secretName };
  const ran = await bay(["call", "command-prober.go", JSON.stringify(input), "--project", project.root, "--json"]);
  assert.equal(ran.exitCode, 0, ran.output);
  const output = fieldOf(fieldOf(toJson(ran.json), "run") ?? null, "output") ?? null;
  return listOf(fieldOf(output, "answers"))[0];
}

test("a trusted project mode's script runs its command from bay call, and is refused once the owner withdraws the trust", async () => {
  const project = await makeCommandKit({ commands: { leave: { run: `node -e ${leavingCode}` } }, tier: "modes" });
  try {
    await writeFiles(project.root, trustRecordFiles(list));
    assert.deepEqual(fieldOf(toJson(await firstAnswer(project)), "ok"), true);
    assert.equal(await leftFile(project), true);
    await rm(join(project.root, "left.txt"));
    await withdrawTrust(project);
    assert.equal(
      fieldOf(toJson(await firstAnswer(project)), "message"),
      "The step 0 of action go asked to run the listed command leave with [] in ., but the owner does not trust " +
        "the list of mode command-prober, so none of its commands or throwaway folders is granted. The owner " +
        "reads the list and decides with: bay approve --trust command-prober.",
    );
    assert.equal(await leftFile(project), false);
  } finally {
    await project.remove();
  }
});
