import assert from "node:assert/strict";
import { test } from "node:test";
import { inScopeParts } from "../scripts/kinds/in-scope.ts";
import type { Changed } from "../scripts/kinds/touched.ts";
import type { ChangedPath } from "../scripts/lib/size.ts";
import { verdictOf, type Verdict } from "../scripts/lib/verdicts.ts";

function judged(scope: readonly string[], changed: Changed): Verdict {
  return verdictOf("scope", "in-scope", inScopeParts(scope, changed));
}

function known(paths: readonly ChangedPath[]): Changed {
  return { known: true, paths };
}

function failedWith(detail: string): Verdict {
  return { item: "scope", kind: "in-scope", verdict: "failed", detail };
}

function outsideNumbered(count: number): readonly ChangedPath[] {
  return Array.from({ length: count }, (_, index) => ({
    how: "added",
    path: `outside/file-${String(index).padStart(3, "0")}.txt`,
  }));
}

test("in-scope: every changed path and both paths of a move in the scope is passed, with the count", () => {
  const changed = known([
    { how: "modified", path: "src/main/sum.txt" },
    { how: "renamed", path: "tests/new.test.ts", from: "tests/old.test.ts" },
    { how: "deleted", path: "src/main/gone.txt" },
  ]);
  assert.deepEqual(judged(["src/main/**", "tests/**"], changed), {
    item: "scope",
    kind: "in-scope",
    verdict: "passed",
    detail: "Every changed path is in the scope: 4 of 4.",
  });
});

test("in-scope: a path that only starts like a folder of the scope and the old path of a move are named outside it", () => {
  const changed = known([
    { how: "added", path: "src/main-old.txt" },
    { how: "modified", path: "src/main/sum.txt" },
    { how: "renamed", path: "src/main/old.txt", from: "docs/old.txt" },
  ]);
  assert.deepEqual(
    judged(["src/main/**", "tests/**"], changed),
    failedWith("2 changed paths are outside the scope: src/main-old.txt, docs/old.txt."),
  );
});

test("in-scope: one path outside is named in the singular, and a pattern without a star names one path only", () => {
  const changed = known([
    { how: "modified", path: "bay/trust.ts" },
    { how: "added", path: "bay/trust.ts/inside.ts" },
  ]);
  assert.deepEqual(
    judged(["bay/trust.ts"], changed),
    failedWith("1 changed path is outside the scope: bay/trust.ts/inside.ts."),
  );
});

test("in-scope: a new path of a move outside the scope is named, though its old path is inside", () => {
  const changed = known([{ how: "renamed", path: "docs/kept.txt", from: "src/kept.txt" }]);
  assert.deepEqual(judged(["src/**"], changed), failedWith("1 changed path is outside the scope: docs/kept.txt."));
});

test("in-scope: nothing changed is passed with a count of nothing", () => {
  assert.deepEqual(judged(["src/**"], known([])), {
    item: "scope",
    kind: "in-scope",
    verdict: "passed",
    detail: "Every changed path is in the scope: 0 of 0.",
  });
});

test("in-scope: what changed not known is inconclusive, never passed", () => {
  assert.deepEqual(judged(["**"], { known: false }), {
    item: "scope",
    kind: "in-scope",
    verdict: "inconclusive",
    reason: "What changed between the base and the head is not known: the worktrees interface did not answer.",
  });
});

test("in-scope: a long list of paths outside is cut to what fits in a detail, and the rest are counted", () => {
  const shown = outsideNumbered(68).map((changed) => changed.path);
  const verdict = judged(["src/**"], known(outsideNumbered(300)));
  assert.deepEqual(verdict, failedWith(`300 changed paths are outside the scope: ${shown.join(", ")}, and 232 more.`));
  assert.equal(verdict.verdict === "failed" ? verdict.detail.length : 0, 1550);
});

test("in-scope: a path outside too long to name is counted and not named", () => {
  const long = `outside/${"x".repeat(1600)}.txt`;
  assert.deepEqual(
    judged(["src/**"], known([{ how: "added", path: long }])),
    failedWith("1 changed path is outside the scope, and its name is too long to show here."),
  );
});

test("in-scope: a scope entry that is not a pattern is inconclusive with the matcher's reason, never passed", () => {
  const changed = known([{ how: "modified", path: "src/sum.txt" }]);
  const notPattern = {
    item: "scope",
    kind: "in-scope",
    verdict: "inconclusive",
    reason:
      'The write scope holds an entry that is not a pattern, so nothing is known: "../up/**" is not a pattern: it holds two dots in a row.',
  };
  assert.deepEqual(judged(["src/**", "../up/**"], changed), notPattern);
  assert.deepEqual(judged(["src/**", "../up/**"], known([])), notPattern);
});

test("in-scope: a changed path the matcher refuses as a path is outside the scope, even of a scope of every path", () => {
  const changed = known([{ how: "added", path: "src/../escape.txt" }]);
  assert.deepEqual(judged(["**"], changed), failedWith("1 changed path is outside the scope: src/../escape.txt."));
});
