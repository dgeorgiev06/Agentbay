import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { nodeFileSystem, systemClock } from "../bay/node-ports.ts";

async function withTemporaryFolder(run: (folder: string) => Promise<void>): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), "agentbay-node-ports-"));
  try {
    await run(folder);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

test("writeAtomic creates missing folders, replaces the file and leaves no temporary file", async () => {
  await withTemporaryFolder(async (folder) => {
    const file = join(folder, "a", "b", "state.json");
    await nodeFileSystem.writeAtomic(file, "first");
    await nodeFileSystem.writeAtomic(file, "second");
    assert.equal(await nodeFileSystem.readText(file), "second");
    assert.deepEqual(await readdir(join(folder, "a", "b")), ["state.json"]);
  });
});

test("readText gives undefined for a missing file", async () => {
  await withTemporaryFolder(async (folder) => {
    assert.equal(await nodeFileSystem.readText(join(folder, "missing.txt")), undefined);
    assert.equal(await nodeFileSystem.readText(join(folder, "missing", "deeper.txt")), undefined);
  });
});

test("list gives sorted names, and nothing for a missing folder", async () => {
  await withTemporaryFolder(async (folder) => {
    await nodeFileSystem.writeAtomic(join(folder, "b.txt"), "");
    await nodeFileSystem.writeAtomic(join(folder, "a", "c.txt"), "");
    assert.deepEqual(await nodeFileSystem.list(folder), ["a", "b.txt"]);
    assert.deepEqual(await nodeFileSystem.list(join(folder, "missing")), []);
  });
});

test("exists tells files and folders that exist from those that do not", async () => {
  await withTemporaryFolder(async (folder) => {
    await nodeFileSystem.writeAtomic(join(folder, "a", "b.txt"), "");
    assert.equal(await nodeFileSystem.exists(join(folder, "a")), true);
    assert.equal(await nodeFileSystem.exists(join(folder, "a", "b.txt")), true);
    assert.equal(await nodeFileSystem.exists(join(folder, "a", "c.txt")), false);
  });
});

test("the system clock tells the current time", () => {
  const before = Date.now();
  const now = systemClock.now().getTime();
  assert.ok(now >= before && now <= Date.now());
});
