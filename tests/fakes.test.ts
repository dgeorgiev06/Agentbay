import assert from "node:assert/strict";
import { test } from "node:test";
import { fakeClock, fakeFileSystem } from "./fakes.ts";

test("the fake file system reads, lists, finds and writes files held in memory", async () => {
  const files = fakeFileSystem({ "/a/b.txt": "b", "/a/c/d.txt": "d" });
  assert.equal(await files.readText("/a/b.txt"), "b");
  assert.equal(await files.readText("/a/missing.txt"), undefined);
  assert.deepEqual(await files.list("/a"), ["b.txt", "c"]);
  assert.deepEqual(await files.list("/missing"), []);
  assert.equal(await files.exists("/a/c"), true);
  assert.equal(await files.exists("/a/c/e.txt"), false);
  await files.writeAtomic("/a/c/e.txt", "e");
  assert.equal(files.contents.get("/a/c/e.txt"), "e");
});

test("the fake clock stands still until it is advanced", () => {
  const clock = fakeClock(new Date("2026-11-14T08:00:00Z"));
  assert.equal(clock.now().toISOString(), "2026-11-14T08:00:00.000Z");
  clock.advance(90_000);
  assert.equal(clock.now().toISOString(), "2026-11-14T08:01:30.000Z");
});
