import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  branchesAfter,
  branchesSaid,
  roundsBranches,
  stayedLines,
  withStayedLines,
} from "../scripts/lib/branch-endings.ts";
import { lastRound } from "../scripts/lib/rounds.ts";

const commit = "1c9a4e0b7d2f3a5c6e8b9d0f1a2b3c4d5e6f7a8b";

const refused = "The branch forge/A1-tests-1 is the branch work is merged into, named as into, so it is kept.";

describe("the branches a slice's rounds can make", () => {
  test("round 1 makes the slice's branch and its first tests branch; each later round a builder and a tests branch", () => {
    assert.deepEqual(roundsBranches("A1", 1), ["forge/A1", "forge/A1-tests-1"]);
    assert.deepEqual(roundsBranches("A1", lastRound), [
      "forge/A1",
      "forge/A1-2",
      "forge/A1-3",
      "forge/A1-tests-1",
      "forge/A1-tests-2",
      "forge/A1-tests-3",
    ]);
  });

  test("a name that starts like another slice's is never confused with it", () => {
    assert.ok(roundsBranches("TD1", lastRound).every((branch) => !branch.startsWith("forge/TD10")));
  });
});

describe("what each ending keeps and drops", () => {
  test("when the rounds end, the builder's last branch and the last tests branch stay and every earlier one goes", () => {
    const work = { builder: "forge/B1-3", head: "forge/B1-tests-3" };
    assert.deepEqual(branchesAfter({ kind: "rounds ended", name: "B1", round: 3, work }), {
      keep: ["forge/B1-3", "forge/B1-tests-3"],
      drop: ["forge/B1", "forge/B1-2", "forge/B1-tests-1", "forge/B1-tests-2"],
    });
  });

  test("rounds that ended in round 2 with round 1's builder keep the slice's own branch", () => {
    const work = { builder: "forge/A1", head: "forge/A1-tests-2" };
    assert.deepEqual(branchesAfter({ kind: "rounds ended", name: "A1", round: 2, work }), {
      keep: ["forge/A1", "forge/A1-tests-2"],
      drop: ["forge/A1-2", "forge/A1-tests-1"],
    });
  });

  test("rounds that ended in round 1 keep both of their branches and drop none", () => {
    const work = { builder: "forge/R1", head: "forge/R1-tests-1" };
    assert.deepEqual(branchesAfter({ kind: "rounds ended", name: "R1", round: 1, work }).drop, []);
  });

  test("a merge drops the merge branch and the two the card named, once the work is in into", () => {
    const work = { builder: "forge/A1-2", head: "forge/A1-tests-2" };
    assert.deepEqual(branchesAfter({ kind: "merged", name: "A1", work }), {
      keep: [],
      drop: ["forge/A1-merge", "forge/A1-2", "forge/A1-tests-2"],
    });
  });

  test("keep leaves exactly the two branches the card named", () => {
    const work = { builder: "forge/B1-3", head: "forge/B1-tests-3" };
    assert.deepEqual(branchesAfter({ kind: "kept", work }), { keep: ["forge/B1-3", "forge/B1-tests-3"], drop: [] });
  });

  test("a design or plan branch goes only once its commit has landed in into", () => {
    assert.deepEqual(branchesAfter({ kind: "committed", name: "todo-design", landed: true }), {
      keep: [],
      drop: ["forge/todo-design"],
    });
    assert.deepEqual(branchesAfter({ kind: "committed", name: "todo-plan", landed: false }), {
      keep: ["forge/todo-plan"],
      drop: [],
    });
  });

  test("a wave's merge drops its own branches and the merged slices', and keeps those of a slice left out", () => {
    const slices = [
      { builder: "forge/CA", head: "forge/CA-tests-1", merged: true },
      { builder: "forge/CB-2", head: "forge/CB-tests-2", merged: false },
    ];
    assert.deepEqual(branchesAfter({ kind: "wave merged", wave: "wave-1", slices }), {
      keep: ["forge/CB-2", "forge/CB-tests-2"],
      drop: ["forge/wave-1-merge", "forge/wave-1", "forge/CA", "forge/CA-tests-1"],
    });
  });

  test("a wave's keep leaves every slice's two branches and the combined branch the card names", () => {
    const slices = [{ builder: "forge/CA", head: "forge/CA-tests-1" }];
    assert.deepEqual(branchesAfter({ kind: "wave kept", wave: "wave-1", combined: true, slices }), {
      keep: ["forge/CA", "forge/CA-tests-1", "forge/wave-1"],
      drop: [],
    });
  });

  test("a wave kept with no combined head drops the combined branch, which the card does not name", () => {
    const slices = [{ builder: "forge/CA", head: "forge/CA-tests-1" }];
    assert.deepEqual(branchesAfter({ kind: "wave kept", wave: "wave-1", combined: false, slices }), {
      keep: ["forge/CA", "forge/CA-tests-1"],
      drop: ["forge/wave-1"],
    });
  });
});

describe("what is said of the branches", () => {
  test("a branch that stayed is a computed line with the reason worktrees gave", () => {
    assert.deepEqual(stayedLines([{ branch: "forge/A1-tests-1", reason: refused }]), [
      {
        mark: "computed",
        words: `forge/A1-tests-1 stayed: ${refused}`,
        source: { step: "draw" },
      },
    ]);
  });

  test("a card gains the lines of the branches that stayed after its own, and is the same when none did", () => {
    const drawn = {
      card: { title: "A card", lines: stayedLines([{ branch: "forge/x", reason: "kept" }]) },
      offered: true,
    };
    assert.equal(withStayedLines(drawn, []), drawn);
    assert.deepEqual(
      withStayedLines(drawn, [{ branch: "forge/y", reason: "kept too" }]).card.lines.map((line) => line.words),
      ["forge/x stayed: kept", "forge/y stayed: kept too"],
    );
  });

  test("an answer names what was dropped and what stayed only when there is any", () => {
    assert.deepEqual(branchesSaid([], []), {});
    assert.deepEqual(branchesSaid([{ branch: "forge/A1", commit }], [{ branch: "forge/A1-2", reason: refused }]), {
      dropped: [{ branch: "forge/A1", commit }],
      stayed: [{ branch: "forge/A1-2", reason: refused }],
    });
  });
});
