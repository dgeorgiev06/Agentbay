import assert from "node:assert/strict";
import { test } from "node:test";
import { decodedStepDetail } from "../../../bay/runs/step-detail.ts";

test("a stored skill step whose role is not one of the kit's refuses to load, with the kernel's sentence", () => {
  const stored = { mode: "notes", action: "a", skill: "skills/x", tier: "deep", schemas: [], round: 1, feedback: [] };
  const detail = decodedStepDetail("skill", { ...stored, role: "reviewer" });
  assert.equal(detail.kind === "skill" ? detail.detail.role : undefined, "reviewer");
  const without = decodedStepDetail("skill", stored);
  assert.equal(without.kind === "skill" && "role" in without.detail, false);
  for (const role of ["lead", "Reviewer", "", 5, null]) {
    assert.throws(() => decodedStepDetail("skill", { ...stored, role }), {
      message: "kernel.db holds a skill step whose detail has no valid role.",
    });
  }
});
