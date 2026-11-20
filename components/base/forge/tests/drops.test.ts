import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { fieldsOf, type Json, type ScriptContext } from "../../../../bay/sdk.ts";
import { committedInto } from "../scripts/lib/commit-files.ts";
import { builtOver, cutAfresh, droppedAll, leftOver, removedThenDropped } from "../scripts/lib/drops.ts";
import { textOf } from "../scripts/lib/json-values.ts";

type Asked = [string, Json][];

type Answering = (reference: string, input: Json) => Json | string;

const commit = "1c9a4e0b7d2f3a5c6e8b9d0f1a2b3c4d5e6f7a8b";

const later = "9e41c2a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6";

const kept = "The worktree .forge/worktrees/A1 of this mode still has the branch forge/A1, so it is kept.";

const notHere = { ok: false, kind: "failed", message: "This test does not answer it." } as const;

function contextOf(asked: Asked, answering: Answering): ScriptContext {
  const unanswered = (): Promise<typeof notHere> => Promise.resolve(notHere);
  const statements = { execute: unanswered, query: unanswered };
  return {
    db: { ...statements, partition: () => ({ ...statements, migrate: unanswered, agentQuery: unanswered }) },
    files: {
      read: unanswered,
      write: () => Promise.resolve({ ok: true, value: null }),
      list: unanswered,
      makeFolder: unanswered,
      link: unanswered,
      remove: unanswered,
    },
    secrets: { get: unanswered },
    http: { request: unanswered },
    events: { emit: unanswered },
    commands: { run: unanswered },
    call: (reference, input) => {
      asked.push([reference, input]);
      const answer = answering(reference, input);
      return Promise.resolve(
        typeof answer === "string" ? { ok: false, kind: "failed", message: answer } : { ok: true, value: answer },
      );
    },
    schemas: { check: unanswered, checkAgainst: unanswered },
    settings: { into: "integration" },
    now: () => new Date("2026-11-20T10:00:00Z"),
    spend: unanswered,
    caller: undefined,
    skillInput: undefined,
  };
}

function branchOf(input: Json): string {
  return textOf(fieldsOf(input).branch);
}

function worktreesAnswer(folders: readonly string[]): Answering {
  return (reference, input) => {
    switch (reference) {
      case "worktrees-left":
        return { folders: [...folders] };
      case "worktrees.drop-branch":
        return { how: "dropped", branch: branchOf(input), commit };
      case "worktrees.cut": {
        const slice = textOf(fieldsOf(input).slice);
        return { folder: `.forge/worktrees/${slice}`, branch: `forge/${slice}`, commit };
      }
      case "worktrees.set-aside":
        return { how: "set-aside", folder: "", branch: "forge/wip/A1/1", commit: later };
      default:
        return { kind: "worktree", branchAfter: "kept", folder: "", branch: "", commit };
    }
  };
}

function references(asked: Asked): readonly string[] {
  return asked.map(([reference]) => reference);
}

describe("every drop forge asks for", () => {
  test("names the integration branch as into, and answers what was dropped and what stayed", async () => {
    const asked: Asked = [];
    const answering: Answering = (_reference, input) => {
      const branch = branchOf(input);
      if (branch === "forge/A1") {
        return { how: "refused", branch, commit, reason: kept };
      }
      return branch === "forge/A1-2" ? { how: "not-there", branch } : { how: "dropped", branch, commit };
    };
    const drops = await droppedAll(
      contextOf(asked, answering),
      ["forge/A1", "forge/A1-2", "forge/A1-3"],
      "integration",
    );
    assert.deepEqual(drops, {
      dropped: [{ branch: "forge/A1-3", commit }],
      stayed: [{ branch: "forge/A1", reason: kept }],
    });
    assert.deepEqual(
      asked.map(([, input]) => fieldsOf(input).into),
      ["integration", "integration", "integration"],
    );
  });

  test("comes after its worktree is removed with the branch kept", async () => {
    const asked: Asked = [];
    const made = { folder: ".forge/worktrees/A1-planter", branch: "forge/A1-planter" };
    await removedThenDropped(contextOf(asked, worktreesAnswer([])), made, "integration");
    assert.deepEqual(asked, [
      ["worktrees.remove", { folder: ".forge/worktrees/A1-planter", branchAfter: "kept" }],
      ["worktrees.drop-branch", { branch: "forge/A1-planter", into: "integration" }],
    ]);
  });
});

describe("a cut of forge's own scratch", () => {
  test("drops a leftover of the same name first, and removes its worktree when one is left", async () => {
    const asked: Asked = [];
    const toCut = { slice: "A1-writer-2", base: commit };
    const cut = await cutAfresh(contextOf(asked, worktreesAnswer(["A1-writer-2", "A10"])), toCut, "integration");
    assert.deepEqual(asked, [
      ["worktrees-left", {}],
      ["worktrees.remove", { folder: ".forge/worktrees/A1-writer-2", branchAfter: "kept" }],
      ["worktrees.drop-branch", { branch: "forge/A1-writer-2", into: "integration" }],
      ["worktrees.cut", { slice: "A1-writer-2", base: commit }],
    ]);
    assert.equal(cut.folder, ".forge/worktrees/A1-writer-2");
  });

  test("removes nothing when no worktree of that name is left", async () => {
    const asked: Asked = [];
    const toCut = { slice: "A1-writer-2", base: commit };
    await cutAfresh(contextOf(asked, worktreesAnswer(["A1-writer-20"])), toCut, "integration");
    assert.deepEqual(references(asked), ["worktrees-left", "worktrees.drop-branch", "worktrees.cut"]);
  });
});

describe("what an earlier run left", () => {
  test("is found by asking worktrees to find each branch, which changes nothing and answers its commit", async () => {
    const asked: Asked = [];
    const answering: Answering = (_reference, input) => {
      const branch = branchOf(input);
      return branch === "forge/A1" ? { how: "found", branch, commit } : { how: "not-there", branch };
    };
    const found = await leftOver(contextOf(asked, answering), ["forge/A1", "forge/A1-tests-1"]);
    assert.deepEqual(found, [{ branch: "forge/A1", commit }]);
    assert.deepEqual(asked, [
      ["worktrees.find-branch", { branch: "forge/A1" }],
      ["worktrees.find-branch", { branch: "forge/A1-tests-1" }],
    ]);
  });

  test("that worktrees will not look for ends the run with its reason", async () => {
    const reason = "The branch forge/wip is not one this mode makes, so the mode does not look at it.";
    const answering: Answering = (_reference, input) => ({ how: "refused", branch: branchOf(input), reason });
    await assert.rejects(leftOver(contextOf([], answering), ["forge/A1", "forge/wip"]), {
      message: `forge could not look for forge/A1, which an earlier run may have left: ${reason}`,
    });
  });

  test("is built over by setting aside and removing a worktree it still has, then dropping it and the work set aside", async () => {
    const asked: Asked = [];
    const dropped = await builtOver(
      contextOf(asked, worktreesAnswer(["A1"])),
      ["forge/A1", "forge/A1-tests-1"],
      "into",
    );
    assert.deepEqual(asked, [
      ["worktrees-left", {}],
      ["worktrees.set-aside", { folder: ".forge/worktrees/A1" }],
      ["worktrees.remove", { folder: ".forge/worktrees/A1", branchAfter: "kept" }],
      ["worktrees.drop-branch", { branch: "forge/A1", into: "into" }],
      ["worktrees.drop-branch", { branch: "forge/A1-tests-1", into: "into" }],
      ["worktrees.drop-branch", { branch: "forge/wip/A1/1", into: "into" }],
    ]);
    assert.deepEqual(
      dropped.map((each) => each.branch),
      ["forge/A1", "forge/A1-tests-1", "forge/wip/A1/1"],
    );
  });

  test("that worktrees will not drop ends the build over with its reason, before anything is cut", async () => {
    const answering: Answering = (reference, input) =>
      reference === "worktrees-left" ? { folders: [] } : { how: "refused", branch: branchOf(input), reason: kept };
    await assert.rejects(builtOver(contextOf([], answering), ["forge/A1"], "integration"), {
      message: `forge could not drop forge/A1, which an earlier run left, so nothing is built over it: ${kept}`,
    });
  });
});

describe("a design or plan committed into the integration branch", () => {
  const files = (): Promise<readonly { path: string; text: string }[]> =>
    Promise.resolve([{ path: "docs/designs/todo/design.yaml", text: "{}\n" }]);
  const asking = { slice: "todo-design", into: "integration", files, message: "todo: the design" };

  function committing(merged: boolean): Answering {
    const plain = worktreesAnswer([]);
    return (reference, input) => {
      if (reference === "worktrees.commit") {
        return { how: "committed", folder: "", branch: "forge/todo-design", commit: later };
      }
      if (reference === "worktrees.merge") {
        return merged ? { how: "merged", branch: "", into: "", commit, landed: "branch-not-checked-out" } : "conflict";
      }
      return plain(reference, input);
    };
  }

  test("drops its branch only after the merge landed and the worktree is removed", async () => {
    const asked: Asked = [];
    const done = await committedInto(contextOf(asked, committing(true)), asking);
    assert.deepEqual(references(asked).slice(-3), ["worktrees.merge", "worktrees.remove", "worktrees.drop-branch"]);
    assert.deepEqual(asked.at(-1), ["worktrees.drop-branch", { branch: "forge/todo-design", into: "integration" }]);
    assert.equal(done.merged, commit);
  });

  test("keeps its branch when the merge did not land, and the run says where the work is", async () => {
    const asked: Asked = [];
    await assert.rejects(committedInto(contextOf(asked, committing(false)), asking), {
      message:
        `forge committed the work as ${later} on forge/todo-design, but it did not land in integration, so the ` +
        "branch stays and holds it: conflict",
    });
    const after = asked.slice(references(asked).indexOf("worktrees.merge"));
    assert.deepEqual(references(after), ["worktrees.merge", "worktrees.remove"]);
  });
});
