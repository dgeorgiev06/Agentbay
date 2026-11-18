import assert from "node:assert/strict";
import { test } from "node:test";
import { pathMatch } from "../../../../bay/sdk.ts";
import { scopesShare, type SharedPath } from "../scripts/lib/scopes.ts";

type Case = {
  readonly first: readonly string[];
  readonly second: readonly string[];
  readonly answer: SharedPath;
};

const noPath: SharedPath = { kind: "share no path" };

function shared(first: string, second: string, example: string): SharedPath {
  return { kind: "share a path", patterns: [first, second], example };
}

function undecided(first: string, second: string, reason: string): SharedPath {
  return { kind: "may share a path", patterns: [first, second], reason };
}

const cases: readonly Case[] = [
  {
    first: ["bay/runs/**"],
    second: ["bay/runs/engine.ts"],
    answer: shared("bay/runs/**", "bay/runs/engine.ts", "bay/runs/engine.ts"),
  },
  { first: ["bay/run"], second: ["bay/runs/**"], answer: noPath },
  { first: ["bay/runs"], second: ["bay/runs/**"], answer: noPath },
  { first: ["bay/run*"], second: ["bay/runs/**"], answer: noPath },
  {
    first: ["bay/broker/*.ts"],
    second: ["bay/broker/rule.ts"],
    answer: shared("bay/broker/*.ts", "bay/broker/rule.ts", "bay/broker/rule.ts"),
  },
  { first: ["bay/broker/*.ts"], second: ["bay/broker/inner/rule.ts"], answer: noPath },
  { first: ["CONTEXT.md"], second: ["CONTEXT.md"], answer: shared("CONTEXT.md", "CONTEXT.md", "CONTEXT.md") },
  {
    first: ["bay/sdk.ts", "CONTEXT.md"],
    second: ["knip.json", "CONTEXT.md", "bay/sdk.ts"],
    answer: shared("bay/sdk.ts", "bay/sdk.ts", "bay/sdk.ts"),
  },
  { first: ["tests/made-up-proofs*.ts"], second: ["tests/made-up-toolchains*.ts"], answer: noPath },
  {
    first: ["tests/made-up-*.ts"],
    second: ["tests/*-proofs.ts"],
    answer: shared("tests/made-up-*.ts", "tests/*-proofs.ts", "tests/made-up-x-proofs.ts"),
  },
  { first: ["**/*.md"], second: ["docs/**"], answer: shared("**/*.md", "docs/**", "docs/x.md") },
  { first: ["**/*.ts"], second: ["**/*.md"], answer: noPath },
  { first: ["src/**"], second: ["src"], answer: noPath },
  { first: ["a/**/b"], second: ["a/b"], answer: shared("a/**/b", "a/b", "a/b") },
  { first: ["a/*/c"], second: ["a/b/*"], answer: shared("a/*/c", "a/b/*", "a/b/c") },
  { first: ["*"], second: ["CONTEXT.md"], answer: shared("*", "CONTEXT.md", "CONTEXT.md") },
  { first: ["*"], second: ["docs/plan.md"], answer: noPath },
  { first: ["**"], second: ["docs/plan.md"], answer: shared("**", "docs/plan.md", "docs/plan.md") },
  { first: ["bay/**"], second: ["tests/**"], answer: noPath },
  {
    first: ["bay/runs/**", "tests/runs*.ts"],
    second: ["tests/runs-rounds*.ts"],
    answer: shared("tests/runs*.ts", "tests/runs-rounds*.ts", "tests/runs-roundsx.ts"),
  },
  { first: ["./bay/sdk.ts"], second: ["bay/sdk.ts"], answer: shared("./bay/sdk.ts", "bay/sdk.ts", "bay/sdk.ts") },
  { first: ["bay/broker**"], second: ["bay/broker/rule.ts"], answer: noPath },
  {
    first: ["bay/broker**"],
    second: ["bay/brokers.ts"],
    answer: shared("bay/broker**", "bay/brokers.ts", "bay/brokers.ts"),
  },
  { first: ["Bay/sdk.ts"], second: ["bay/sdk.ts"], answer: noPath },
  { first: ["*.ts"], second: [".*"], answer: shared("*.ts", ".*", ".x.ts") },
  { first: [], second: ["**"], answer: noPath },
  {
    first: ["bay//sdk.ts"],
    second: ["bay/sdk.ts"],
    answer: undecided("bay//sdk.ts", "bay/sdk.ts", '"bay//sdk.ts" is not a pattern: it holds two slashes in a row.'),
  },
  {
    first: ["docs/plans/*.yaml"],
    second: ["../docs/**"],
    answer: undecided("docs/plans/*.yaml", "../docs/**", '"../docs/**" is not a pattern: it holds two dots in a row.'),
  },
  {
    first: ["bay//sdk.ts", "tests/**"],
    second: ["tests/path-match.test.ts"],
    answer: shared("tests/**", "tests/path-match.test.ts", "tests/path-match.test.ts"),
  },
];

const probes: readonly string[] = [
  "bay/run",
  "bay/runs",
  "bay/runs/engine.ts",
  "bay/runs/inner/step.ts",
  "bay/broker/rule.ts",
  "bay/broker/inner/rule.ts",
  "bay/brokers.ts",
  "bay/sdk.ts",
  "CONTEXT.md",
  "docs/plan.md",
  "docs/x.md",
  "src",
  "src/a.ts",
  "a/b",
  "a/b/c",
  "tests/made-up-proofs.ts",
  "tests/made-up-toolchains.ts",
  "x.ts",
  ".x.ts",
];

function inScope(scope: readonly string[], path: string): boolean {
  return scope.some((pattern) => pathMatch(pattern, path).kind === "matched");
}

test("whether two scopes share a path, for each pair of the table", () => {
  for (const { first, second, answer } of cases) {
    assert.deepEqual(scopesShare(first, second), answer, `${first.join(", ")} against ${second.join(", ")}`);
  }
});

test("the answer is the same with the two scopes swapped, but for the order of the patterns", () => {
  for (const { first, second, answer } of cases) {
    const swapped = scopesShare(second, first);
    assert.equal(swapped.kind, answer.kind, `${second.join(", ")} against ${first.join(", ")}`);
  }
});

test("each example path is in both scopes by in-scope's own matching", () => {
  for (const { first, second, answer } of cases) {
    if (answer.kind === "share a path") {
      assert.ok(inScope(first, answer.example), `${answer.example} in ${first.join(", ")}`);
      assert.ok(inScope(second, answer.example), `${answer.example} in ${second.join(", ")}`);
    }
  }
});

test("no probe path is in both scopes of a pair that shares no path, by in-scope's own matching", () => {
  const examples = cases.flatMap(({ answer }) => (answer.kind === "share a path" ? [answer.example] : []));
  for (const { first, second, answer } of cases) {
    if (answer.kind === "share no path") {
      const inBoth = [...probes, ...examples].filter((path) => inScope(first, path) && inScope(second, path));
      assert.deepEqual(inBoth, [], `${first.join(", ")} against ${second.join(", ")}`);
    }
  }
});
