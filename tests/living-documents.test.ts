import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { join, relative } from "node:path";
import { after, before, test } from "node:test";
import { copyOfTheKit, frozenDocuments, isLivingDocument, livingFolders } from "./test-toolbox.ts";
import { kit } from "./project-fixture.ts";

let copy: string;

before(async () => {
  copy = await copyOfTheKit("living-folders");
});

after(async () => {
  await rm(copy, { recursive: true, force: true });
});

async function filesUnder(folder: string): Promise<readonly string[]> {
  if (!existsSync(join(copy, folder))) {
    return [];
  }
  const entries = await readdir(join(copy, folder), { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  return files.map((entry) => relative(copy, join(entry.parentPath, entry.name)));
}

test("a copy of the kit holds under docs/requirements, docs/designs and docs/plans only the frozen fixtures", async () => {
  const held = (await Promise.all(livingFolders.map(filesUnder))).flat();
  assert.deepEqual([...held].sort(), Object.keys(frozenDocuments).sort());
  for (const [file, fixture] of Object.entries(frozenDocuments)) {
    assert.deepEqual(await readFile(join(copy, file)), await readFile(join(kit, fixture)), file);
  }
});

test("every frozen document stands at a living path and is read from tests/fixtures, never from a living folder", () => {
  for (const [file, fixture] of Object.entries(frozenDocuments)) {
    assert.equal(isLivingDocument(file), true, file);
    assert.equal(fixture.startsWith("tests/fixtures/"), true, fixture);
    assert.equal(isLivingDocument(fixture), false, fixture);
  }
});

test("a living document is a path under one of the three folders, and nothing beside them", () => {
  assert.deepEqual(livingFolders, ["docs/requirements/", "docs/designs/", "docs/plans/"]);
  assert.equal(isLivingDocument("docs/plans/0025-todo.yaml"), true);
  assert.equal(isLivingDocument("docs/designs/todo/schemas/todo/add-request.json"), true);
  assert.equal(isLivingDocument("docs/adr/0029-roles.md"), false);
  assert.equal(isLivingDocument("docs/plans-old/x.md"), false);
});
