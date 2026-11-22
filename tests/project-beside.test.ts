import assert from "node:assert/strict";
import { test } from "node:test";
import { projectBesideTheKit } from "./project-beside.ts";

test("a project root that is the kit's own folder is no project beside the kit, so nothing is copied", () => {
  assert.equal(projectBesideTheKit("/work/kit", "/work/kit"), undefined);
});

test("a project root in another folder is the project beside the kit, even when the kit is inside it", () => {
  assert.equal(projectBesideTheKit("/work/project", "/work/kit"), "/work/project");
  assert.equal(projectBesideTheKit("/work", "/work/kit"), "/work");
  assert.equal(projectBesideTheKit("/work/kit/inner", "/work/kit"), "/work/kit/inner");
});
