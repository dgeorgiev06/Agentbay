import assert from "node:assert/strict";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import type { Answer } from "../bay/answers.ts";
import { createBroker, type StepBroker } from "../bay/broker/broker.ts";
import type { Effect, GrantedCommand, ListTrust, ModeList, TrustGiven } from "../bay/contracts.ts";
import {
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeProcesses,
  nodeThrowawayFolders,
  systemClock,
} from "../bay/node-ports.ts";
import type { FileSystem } from "../bay/ports.ts";
import { SecretStore } from "../bay/secrets.ts";
import { listHashOf, readTrustRecord, recordWithoutTrust, recordWithTrust, type TrustRecord } from "../bay/trust.ts";
import {
  noProcesses,
  permissionsIn,
  place,
  projectLayout,
  recordingSink,
  refusalOf,
  scriptedHttp,
  valueOf,
  withProject,
} from "./broker-fixture.ts";
import { trustGiving, trustRecordFileOf, trustRecordFiles } from "./system-fixture.ts";

const everyEffect: readonly Effect[] = ["read", "write", "network", "spend", "delete"];

const leaving: GrantedCommand = {
  name: "leave",
  words: ["node", "-e", "require('node:fs').writeFileSync('left.txt','x')"],
  effects: ["read", "write"],
};

const list: ModeList = { mode: "notes", commands: [leaving], commandsStartWith: [], throwaway: ["scratch"] };

const olderList: ModeList = { ...list, commands: [{ ...leaving, effects: ["read"] }] };

const olderGiven: TrustGiven = { list: olderList, hash: listHashOf(olderList), ...trustGiving };

const laterGiving = { at: "2026-11-19T09:40:00.000Z", by: "a test", scripts: {} } as const;

const unreadableText = "{";

type Setup = {
  readonly root: string;
  readonly broker: StepBroker;
  readonly recordReads: () => number;
};

type Loaded = {
  readonly listTrust: ListTrust;
  readonly granted: boolean;
  readonly recordText?: string;
};

function countingRecordReads(root: string): { readonly files: FileSystem; readonly reads: () => number } {
  const record = join(root, ".agentbay", "trust.json");
  let reads = 0;
  return {
    files: {
      ...nodeFileSystem,
      readText: (path) => {
        if (path === record) {
          reads += 1;
        }
        return nodeFileSystem.readText(path);
      },
    },
    reads: () => reads,
  };
}

async function writeFiles(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text, "utf8");
  }
}

async function recordIn(root: string): Promise<TrustRecord> {
  const record = await readTrustRecord(nodeFileSystem, projectLayout(root));
  assert.ok(record.ok, JSON.stringify(record));
  return record.value;
}

async function withListBroker(loaded: Loaded, run: (setup: Setup) => Promise<void>): Promise<void> {
  await withProject(async (root) => {
    await writeFiles(root, { "shared/kept.txt": "kept", "scratch/kept/a.txt": "kept" });
    if (loaded.recordText !== undefined) {
      await writeFiles(root, trustRecordFileOf(loaded.recordText));
    }
    const counting = countingRecordReads(root);
    const listGrants = loaded.granted
      ? { commands: [leaving], throwawayPaths: [join(root, "scratch")] }
      : { commands: [], throwawayPaths: [] };
    const broker = createBroker({
      layout: projectLayout(root),
      files: counting.files,
      throwawayFolders: nodeThrowawayFolders,
      inspector: nodeFileInspector,
      http: scriptedHttp(() => ({ status: 500, headers: {}, body: "" })),
      secrets: new SecretStore({ environment: {}, processes: noProcesses, platform: "linux" }),
      events: recordingSink(),
      clock: systemClock,
      childProcesses: nodeChildProcesses,
      processes: nodeProcesses,
      commandSearchPath: process.env.PATH ?? "/usr/bin:/bin",
    }).forStep(place, permissionsIn(root, { effects: everyEffect, listTrust: loaded.listTrust, ...listGrants }));
    try {
      await run({ root, broker, recordReads: counting.reads });
    } finally {
      broker.close();
    }
  });
}

async function unreadableProblems(): Promise<ListTrust> {
  let listTrust: ListTrust | undefined;
  await withProject(async (root) => {
    await writeFiles(root, trustRecordFileOf(unreadableText));
    const record = await readTrustRecord(nodeFileSystem, projectLayout(root));
    assert.ok(!record.ok);
    listTrust = { state: "unreadable record", list, problems: record.problems };
  });
  assert.ok(listTrust !== undefined);
  return listTrust;
}

async function existsIn(root: string, path: string): Promise<boolean> {
  try {
    await lstat(join(root, path));
    return true;
  } catch {
    return false;
  }
}

function messageOf<T>(answer: Answer<T>): string {
  return refusalOf(answer).message;
}

type Operation = {
  readonly asked: string;
  readonly ask: (broker: StepBroker) => Promise<Answer<unknown>>;
};

const operations: readonly Operation[] = [
  {
    asked: "The step look.0 of action look asked to run the listed command leave with [] in .",
    ask: (broker) => broker.ask("commands.run", { name: "leave", arguments: [], folder: ".", timeLimitSeconds: 30 }),
  },
  {
    asked: "The step look.0 asked to make the folder scratch/one",
    ask: (broker) => broker.ask("files.makeFolder", { path: "scratch/one" }),
  },
  {
    asked: "The step look.0 asked to link scratch/one to shared",
    ask: (broker) => broker.ask("files.link", { path: "scratch/one", target: "shared" }),
  },
  {
    asked: "The step look.0 asked to remove scratch/kept",
    ask: (broker) => broker.ask("files.remove", { path: "scratch/kept" }),
  },
];

async function nothingDone(root: string): Promise<void> {
  assert.deepEqual(
    {
      left: await existsIn(root, "left.txt"),
      made: await existsIn(root, "scratch/one"),
      kept: await existsIn(root, "scratch/kept/a.txt"),
    },
    { left: false, made: false, kept: true },
  );
}

async function assertEachRefused(setup: Setup, ending: string): Promise<void> {
  for (const operation of operations) {
    assert.equal(messageOf(await operation.ask(setup.broker)), `${operation.asked}${ending}`);
  }
  await nothingDone(setup.root);
}

const neverTrusted =
  ", but the owner does not trust the list of mode notes, so none of its commands or throwaway folders is " +
  "granted. The owner reads the list and decides with: bay approve --trust notes.";

const changedSinceTrusted =
  ", but the list of mode notes is not the list the owner trusted on 2026-11-17, so none of its commands or " +
  "throwaway folders is granted. The owner reads what changed and decides with: bay approve --trust notes.";

const unreadable =
  ", but the trust record .agentbay/trust.json is not JSON, so no list it holds is granted. The owner removes " +
  ".agentbay/trust.json, then trusts each mode again, this one with: bay approve --trust notes.";

const withdrawnAfterLoad =
  ", but the owner does not trust the list of mode notes, so none of its commands or throwaway folders is " +
  "granted; the trust record changed after this run loaded the mode's list. The owner reads the list and " +
  "decides with: bay approve --trust notes.";

const otherListAfterLoad =
  ", but the list of mode notes is not the list the owner trusted on 2026-11-19, so none of its commands or " +
  "throwaway folders is granted; the trust record changed after this run loaded the mode's list. The owner " +
  "reads what changed and decides with: bay approve --trust notes.";

const unreadableAfterLoad =
  ", but the trust record .agentbay/trust.json is not JSON, so no list it holds is granted; the trust record " +
  "changed after this run loaded the mode's list. The owner removes .agentbay/trust.json, then trusts each " +
  "mode again, this one with: bay approve --trust notes.";

test("each operation of a mode whose list the owner never trusted is refused with the sentence that says how to decide", async () => {
  await withListBroker({ listTrust: { state: "never trusted", list }, granted: false }, async (setup) => {
    await assertEachRefused(setup, neverTrusted);
  });
});

test("each operation of a mode whose list changed since the owner trusted it is refused with the day of the trust", async () => {
  await withListBroker({ listTrust: { state: "changed", list, given: olderGiven }, granted: false }, async (setup) => {
    await assertEachRefused(setup, changedSinceTrusted);
  });
});

test("each operation of a mode is refused with the guard's first sentence when the trust record could not be read", async () => {
  await withListBroker({ listTrust: await unreadableProblems(), granted: false }, async (setup) => {
    await assertEachRefused(setup, unreadable);
  });
});

test("a name the mode does not list gets the trust sentence while its list is not in force", async () => {
  await withListBroker({ listTrust: { state: "never trusted", list }, granted: false }, async ({ broker }) => {
    const asked = { name: "other", arguments: ["-1"], folder: ".", timeLimitSeconds: 30 };
    assert.equal(
      messageOf(await broker.ask("commands.run", asked)),
      `The step look.0 of action look asked to run the listed command other with ["-1"] in .${neverTrusted}`,
    );
  });
});

const trusted: Loaded = {
  listTrust: { state: "trusted", given: { list, hash: listHashOf(list), ...trustGiving } },
  granted: true,
  recordText: Object.values(trustRecordFiles(list))[0] ?? "",
};

const leave = { name: "leave", arguments: [], folder: ".", timeLimitSeconds: 30 };

async function assertEachRuns(setup: Setup): Promise<void> {
  const { root, broker } = setup;
  assert.deepEqual(valueOf(await broker.ask("commands.run", leave)).end, { how: "exited", exitCode: 0 });
  assert.deepEqual(await broker.ask("files.makeFolder", { path: "scratch/one" }), { ok: true, value: null });
  assert.deepEqual(await broker.ask("files.link", { path: "scratch/one/shared", target: "shared" }), {
    ok: true,
    value: null,
  });
  assert.deepEqual(await broker.ask("files.remove", { path: "scratch/kept" }), { ok: true, value: null });
  assert.deepEqual(
    {
      left: await existsIn(root, "left.txt"),
      linked: await existsIn(root, "scratch/one/shared"),
      kept: await existsIn(root, "scratch/kept"),
    },
    { left: true, linked: true, kept: false },
  );
}

test("a trusted mode's command and throwaway operations run while the record holds its list, each after a read of it", async () => {
  await withListBroker(trusted, async (setup) => {
    await assertEachRuns(setup);
    assert.equal(setup.recordReads(), 4);
  });
});

test("each operation is refused, and nothing is done, when the owner withdrew the trust after the run loaded it", async () => {
  await withListBroker(trusted, async (setup) => {
    await writeFiles(setup.root, trustRecordFileOf(recordWithoutTrust(await recordIn(setup.root), "notes")));
    await assertEachRefused(setup, withdrawnAfterLoad);
  });
});

test("each operation is refused when the record holds another list of the mode than the run loaded", async () => {
  await withListBroker(trusted, async (setup) => {
    const other = recordWithTrust(await recordIn(setup.root), olderList, laterGiving);
    await writeFiles(setup.root, trustRecordFileOf(other));
    await assertEachRefused(setup, otherListAfterLoad);
  });
});

test("each operation is refused when the trust record cannot be read after the run loaded it", async () => {
  await withListBroker(trusted, async (setup) => {
    await writeFiles(setup.root, trustRecordFileOf(unreadableText));
    await assertEachRefused(setup, unreadableAfterLoad);
  });
});

test("a base mode's command and throwaway operations run with the trust record unreadable, and never read it", async () => {
  const base: Loaded = { listTrust: { state: "not needed" }, granted: true, recordText: unreadableText };
  await withListBroker(base, async (setup) => {
    await assertEachRuns(setup);
    assert.equal(setup.recordReads(), 0);
  });
});
