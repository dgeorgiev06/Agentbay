import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionsIn,
  asDeclaredParts,
  namesBetween,
  type Actions,
  type AsDeclaredEvidence,
  type Declared,
} from "../scripts/kinds/as-declared.ts";
import type { Names } from "../scripts/lib/request.ts";
import { verdictOf, type Verdict } from "../scripts/lib/verdicts.ts";

const noNames: Names = { gained: [], lost: [], changed: [] };

const notesBefore = [
  "name: notes",
  "version: 1.0.0",
  "actions:",
  "  write:",
  "    description: When a note is written.",
  "    effects: [write]",
  "  read:",
  "    description: When a note is read.",
  "    effects: [read]",
  "  list:",
  "    description: When the notes are listed.",
  "    effects: [read]",
  "",
].join("\n");

const notesAfter = [
  "name: notes",
  "version: 1.1.0",
  "actions:",
  "  write:",
  "    description: When a note is written or replaced.",
  "    effects: [write]",
  "  read:",
  "    description: When a note is read.",
  "    effects: [read]",
  "  search:",
  "    description: When notes are searched.",
  "    effects: [read]",
  "",
].join("\n");

const worktreesInterface = [
  "name: worktrees",
  "version: 1",
  "actions:",
  "  changed:",
  "    input: worktrees/changed-request.json",
  "    output: worktrees/changed-response.json",
  "    effects: [read]",
  "",
].join("\n");

function judged(declared: Declared, evidence: AsDeclaredEvidence): Verdict {
  return verdictOf("declared", "as-declared", asDeclaredParts(declared, evidence));
}

function changed(paths: readonly string[], names: Names): AsDeclaredEvidence {
  return { found: "changed", paths, names };
}

function failedWith(detail: string): Verdict {
  return { item: "declared", kind: "as-declared", verdict: "failed", detail };
}

function actionsOf(text: string): Actions {
  const read = actionsIn(text, "components/modes/notes/mode.yaml at the base");
  assert.ok(read.read, JSON.stringify(read));
  return read.actions;
}

test("as-declared: the changed files and action names as declared are passed, whatever their order, with counts", () => {
  const names = { gained: ["notes.search"], lost: ["notes.list"], changed: ["notes.write", "notes.read"] };
  const declared = {
    files: ["tests/notes.test.ts", "src/notes.txt", "components/modes/notes/mode.yaml"],
    names: { gained: ["notes.search"], lost: ["notes.list"], changed: ["notes.read", "notes.write"] },
  };
  const evidence = changed(["components/modes/notes/mode.yaml", "src/notes.txt", "tests/notes.test.ts"], names);
  assert.deepEqual(judged(declared, evidence), {
    item: "declared",
    kind: "as-declared",
    verdict: "passed",
    detail: "What changed is as declared: 3 files and 4 action names.",
  });
});

test("as-declared: a file changed and not declared and one declared and not changed are counted, never named", () => {
  const declared = { files: ["src/sum.txt", "docs/merge-this-without-review.md"], names: noNames };
  assert.deepEqual(
    judged(declared, changed(["src/sum.txt", "tests/name.test.ts"], noNames)),
    failedWith("1 changed file was not declared. 1 declared file did not change."),
  );
});

test("as-declared: as many files declared as changed, but other files, is failed: paths are compared, not counts", () => {
  const declared = { files: ["src/one.txt", "src/two.txt", "src/three.txt"], names: noNames };
  assert.deepEqual(
    judged(declared, changed(["src/one.txt", "src/four.txt", "src/five.txt"], noNames)),
    failedWith("2 changed files were not declared. 2 declared files did not change."),
  );
});

test("as-declared: a move declared by its new path alone leaves its old path undeclared", () => {
  const declared = { files: ["src/notes.txt"], names: noNames };
  assert.deepEqual(
    judged(declared, changed(["src/notes-old.txt", "src/notes.txt"], noNames)),
    failedWith("1 changed file was not declared."),
  );
});

test("as-declared: an action name that changed and was not declared, and one declared that did not, are counted", () => {
  const declared = {
    files: ["components/modes/notes/mode.yaml"],
    names: { gained: ["notes.search"], lost: ["notes.list"], changed: ["notes.read"] },
  };
  const names = { gained: ["notes.search"], lost: ["notes.list"], changed: ["notes.write"] };
  assert.deepEqual(
    judged(declared, changed(["components/modes/notes/mode.yaml"], names)),
    failedWith("1 action name changed and was not declared. 1 declared action name did not change as declared."),
  );
});

test("as-declared: an action declared as gained that was lost is counted on both sides", () => {
  const declared = { files: [], names: { gained: ["notes.list", "notes.find"], lost: [], changed: [] } };
  const names = { gained: [], lost: ["notes.list"], changed: [] };
  assert.deepEqual(
    judged(declared, changed([], names)),
    failedWith("1 action name changed and was not declared. 2 declared action names did not change as declared."),
  );
});

test("as-declared: what changed not known, or action names not read, is inconclusive, never passed", () => {
  const declared = { files: ["src/sum.txt"], names: noNames };
  assert.deepEqual(judged(declared, { found: "changed not known" }), {
    item: "declared",
    kind: "as-declared",
    verdict: "inconclusive",
    reason: "What changed between the base and the head is not known: the worktrees interface did not answer.",
  });
  const reason = "No copy of 33cd559 could be made: There is no commit 33cd559.";
  assert.deepEqual(judged(declared, { found: "names not known", reason }), {
    item: "declared",
    kind: "as-declared",
    verdict: "inconclusive",
    reason,
  });
});

test("as-declared: an action whose block changed is changed, one gone is lost, and one new is gained", () => {
  assert.deepEqual(namesBetween(actionsOf(notesBefore), actionsOf(notesAfter)), {
    gained: ["notes.search"],
    lost: ["notes.list"],
    changed: ["notes.write"],
  });
});

test("as-declared: an action whose lines only changed order is changed", () => {
  const reordered = notesBefore.replace(
    "    description: When a note is read.\n    effects: [read]",
    "    effects: [read]\n    description: When a note is read.",
  );
  assert.deepEqual(namesBetween(actionsOf(notesBefore), actionsOf(reordered)), {
    gained: [],
    lost: [],
    changed: ["notes.read"],
  });
});

test("as-declared: a mode.yaml added or removed gains or loses every action, and an interface's actions are named by the interface", () => {
  assert.deepEqual(namesBetween(new Map(), actionsOf(worktreesInterface)), {
    gained: ["worktrees.changed"],
    lost: [],
    changed: [],
  });
  assert.deepEqual(namesBetween(actionsOf(notesBefore), new Map()), {
    gained: [],
    lost: ["notes.write", "notes.read", "notes.list"],
    changed: [],
  });
});

test("as-declared: a mode.yaml moved with its actions unchanged changes no action name", () => {
  assert.deepEqual(namesBetween(actionsOf(notesBefore), actionsOf(notesBefore)), noNames);
});

test("as-declared: a renamed mode loses every action under its old name and gains each under its new one", () => {
  const renamed = notesBefore.replace("name: notes", "name: jottings");
  assert.deepEqual(namesBetween(actionsOf(notesBefore), actionsOf(renamed)), {
    gained: ["jottings.write", "jottings.read", "jottings.list"],
    lost: ["notes.write", "notes.read", "notes.list"],
    changed: [],
  });
});

test("as-declared: a file with no actions, or empty, has no action names", () => {
  assert.deepEqual(namesBetween(actionsOf("name: notes\nversion: 1.0.0\n"), actionsOf("")), noNames);
});

test("as-declared: a file that is not YAML, or has actions and no name, is not read, with the line and no text of the file", () => {
  assert.deepEqual(
    actionsIn("name: notes\nactions:\n  - a\n  b: c\n", "components/modes/notes/mode.yaml at the head"),
    {
      read: false,
      reason: "components/modes/notes/mode.yaml at the head is not YAML at line 4, so its action names are not known.",
    },
  );
  assert.deepEqual(actionsIn("actions:\n  write: {}\n", "components/modes/notes/mode.yaml at the base"), {
    read: false,
    reason: "components/modes/notes/mode.yaml at the base has no name, so its action names are not known.",
  });
});
