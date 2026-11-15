import assert from "node:assert/strict";
import { test } from "node:test";
import { layoutOf } from "../bay/layout.ts";
import { runResult } from "../bay/run-report.ts";
import type { Run } from "../bay/runs/runs.ts";

const layout = layoutOf({ kit: "/kit", project: "/project" });

function endedRun(state: Run["state"]): Run {
  return {
    id: "r1",
    target: { kind: "action", mode: "notes", name: "save" },
    state,
    spent: { items: 0, usd: 0, tokens: 0, minutes: 0 },
    createdAt: "2026-11-15T09:00:00.000Z",
    updatedAt: "2026-11-15T09:00:00.000Z",
    steps: [],
    events: [],
  };
}

test("the run report exits 1 for a failed or an undone run and 0 for a done one", () => {
  const undo = { undone: [{ stepKey: "0", action: "store.put" }], failed: [], noUndo: [], deleteNotUndone: [] };
  const undone = runResult(layout, { ok: true, value: endedRun({ status: "undone", reason: "it failed", undo }) });
  assert.equal(undone.exitCode, 1);
  assert.equal(undone.json.ok, false);
  assert.equal(undone.text, "run r1 (action notes.save): undone\nreason: it failed");
  const failed = runResult(layout, { ok: true, value: endedRun({ status: "failed", reason: "it failed" }) });
  assert.equal(failed.exitCode, 1);
  const done = runResult(layout, { ok: true, value: endedRun({ status: "done", output: null }) });
  assert.equal(done.exitCode, 0);
});
