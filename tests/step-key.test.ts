import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actionEndKey,
  actionStepKey,
  checkStepKey,
  foreachItemKey,
  isInsideFrame,
  isUndoKey,
  parseStepKey,
  scriptCallKey,
  skillRoundKey,
  skillRoundOf,
  stepKeyText,
  undoStepKey,
  workflowStepKey,
} from "../bay/step-key.ts";

test("the constructors write the keys the run store has always held", () => {
  assert.equal(actionStepKey("", 3), "3");
  assert.equal(actionStepKey("0.call1", 2), "0.call1/2");
  assert.equal(actionEndKey(""), "end");
  assert.equal(actionEndKey("fetch"), "fetch/end");
  assert.equal(skillRoundKey("1", 2), "1#2");
  assert.equal(checkStepKey("1", 2, 0), "1#2.check0");
  assert.equal(scriptCallKey("0", 1), "0.call1");
  assert.equal(scriptCallKey(checkStepKey("1", 2, 0), 0), "1#2.check0.call0");
  assert.equal(workflowStepKey("", "fetch"), "fetch");
  assert.equal(foreachItemKey("loop", 4), "loop[4]");
  assert.equal(workflowStepKey(foreachItemKey("loop", 4), "keep"), "loop[4].keep");
  assert.equal(undoStepKey(0), "undo[0]");
  assert.equal(actionStepKey(undoStepKey(0), 1), "undo[0]/1");
});

test("every key a constructor writes parses back to the same text", () => {
  const keys = [
    "3",
    "end",
    "0.call1/2",
    "0.call1/end",
    "1#2",
    "1#2.check0",
    "1#2.check0.call3",
    "fetch",
    "fetch/0",
    "fetch/0#1",
    "loop[0].keep",
    "loop[0].inner[2].deep/1.call0",
    "undo[0]",
    "undo[3]/1.call0/0",
  ];
  for (const key of keys) {
    const parsed = parseStepKey(key);
    assert.ok(parsed !== undefined, key);
    assert.equal(stepKeyText(parsed), key);
  }
});

test("a key is read by its grammar: an undo key and the items of a foreach named undo stay apart", () => {
  assert.deepEqual(parseStepKey("undo[0]"), [{ kind: "undo", index: 0 }]);
  assert.deepEqual(parseStepKey("undo[0].keep"), [
    { kind: "workflow", id: "undo" },
    { kind: "item", index: 0 },
    { kind: "workflow", id: "keep" },
  ]);
  assert.ok(isUndoKey("undo[0]/2"));
  assert.ok(!isUndoKey("undo[0].keep"));
  assert.ok(!isUndoKey("undo"));
  assert.deepEqual(parseStepKey("loop[1].check0"), [
    { kind: "workflow", id: "loop" },
    { kind: "item", index: 1 },
    { kind: "workflow", id: "check0" },
  ]);
  assert.deepEqual(parseStepKey("1#1.check0"), [
    { kind: "step", index: 1 },
    { kind: "round", round: 1 },
    { kind: "check", index: 0 },
  ]);
});

test("text that no constructor writes is not a key", () => {
  for (const text of ["", "/0", "0/", "01", "0#", "0#x", "0.check0", "loop[0]x", "Fetch", "0..call0", "a#1", "end#1"]) {
    assert.equal(parseStepKey(text), undefined, text);
  }
});

test("the questions the engine asks of a key", () => {
  assert.deepEqual(skillRoundOf("0.call1/2#3"), { step: "0.call1/2", round: 3 });
  assert.equal(skillRoundOf("0.call1/2"), undefined);
  assert.equal(skillRoundOf("1#2.check0"), undefined);
  assert.ok(isInsideFrame("0.call1/2", "0.call1"));
  assert.ok(isInsideFrame("fetch/0.call0/1", "fetch"));
  assert.ok(isInsideFrame("fetch/end", "fetch"));
  assert.ok(!isInsideFrame("fetch", "fetch"));
  assert.ok(!isInsideFrame("fetch-more/0", "fetch"));
  assert.ok(!isInsideFrame("0.call10/0", "0.call1"));
  assert.ok(!isInsideFrame("0.call1", "0"));
});
