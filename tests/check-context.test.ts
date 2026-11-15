import assert from "node:assert/strict";
import { test } from "node:test";
import { lineOfIndex, loadCheckContext, type CheckContext } from "../bay/check-context.ts";
import { fakeFileSystem } from "./fakes.ts";
import { cleanFiles, listingOf } from "./check-fixture.ts";
import { layout, rooted } from "./system-fixture.ts";

async function contextOf(files: Readonly<Record<string, string>>): Promise<CheckContext> {
  const fake = fakeFileSystem(rooted(files));
  return loadCheckContext({ files: fake, listing: listingOf(fake), layout, active: new Set() });
}

test("the check context finds mode folders with a manifest and skips the interfaces folder", async () => {
  const files = {
    ...cleanFiles(),
    "components/base/interfaces/mode.yaml": "name: stray\n",
    "components/base/typescript/README.md": "configs, not a mode",
    "components/modes/broken/mode.yaml": "name: broken\n",
  };
  const context = await contextOf(files);
  const folders = context.modes.map((mode) => [mode.label, mode.manifest?.value.name]);
  assert.deepEqual(folders, [
    ["components/base/store", "store"],
    ["components/modes/briefing", "briefing"],
    ["components/modes/broken", undefined],
    ["components/modes/notes", "notes"],
  ]);
  const notes = context.modes.find((mode) => mode.folder === "/kit/components/modes/notes");
  assert.ok(notes?.files.includes("skills/write-note/SKILL.md"));
});

test("the check context indexes interfaces by name and major version, ignoring other files", async () => {
  const files = { ...cleanFiles(), "components/base/interfaces/notes.md": "not an interface" };
  const context = await contextOf(files);
  assert.deepEqual([...context.interfaces.keys()].sort(), ["items-store@1", "notes@1"]);
});

test("lineOfIndex counts lines from 1", () => {
  assert.equal(lineOfIndex("a\nb\nc", 0), 1);
  assert.equal(lineOfIndex("a\nb\nc", 2), 2);
  assert.equal(lineOfIndex("a\nb\nc", 4), 3);
});
