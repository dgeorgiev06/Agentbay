import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";

let project: ModeProject;

const caller = "query-tests";

before(async () => {
  project = await openModeProject(
    { bindings: { "items-store": "store" }, adapter: "claude-code", modes: ["store"] },
    { callers: [caller] },
  );
});

after(async () => {
  await project.close();
});

test("a search with no letters or digits is refused with a sentence that says what to give", async () => {
  for (const search of ['"', "***", "(", " - "]) {
    const reason = await project.failure("items-store.query", { search }, { caller });
    assert.match(reason, /has no letters or digits to look for; give at least one word/, search);
    assert.doesNotMatch(reason, /fts5|syntax error/i, search);
  }
});
