import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { pathMatch, type PathMatch } from "../bay/sdk.ts";
import { kit } from "./project-fixture.ts";

type Case = readonly [pattern: string, path: string, kind: PathMatch["kind"]];

const table: readonly Case[] = [
  ["bay/broker/*.ts", "bay/broker/rule.ts", "matched"],
  ["bay/broker/*.ts", "bay/broker/inner/rule.ts", "not matched"],
  ["bay/*", "bay/sdk.ts", "matched"],
  ["bay/*", "bay/broker/rule.ts", "not matched"],
  ["bay/*", "bay/.hidden", "matched"],
  ["*", "README.md", "matched"],
  ["*", "bay/sdk.ts", "not matched"],
  ["*.ts", "sdk.ts", "matched"],
  ["*.ts", "sdk.ts.bak", "not matched"],
  ["src/*.test.ts", "src/one.test.ts", "matched"],
  ["src/a.ts", "src/axts", "not matched"],
  ["bay/sdk.ts", "bay/sdk.ts", "matched"],
  ["bay/sdk.ts", "bay/sdk.tsx", "not matched"],
  ["bay/broker/**", "bay/broker/rule.ts", "matched"],
  ["bay/broker/**", "bay/broker/inner/deep/rule.ts", "matched"],
  ["bay/broker/**", "bay/brokers.ts", "not matched"],
  ["bay/broker/**", "bay/broker", "not matched"],
  ["bay/broker", "bay/broker/rule.ts", "not matched"],
  ["**", "any/path/at/all.txt", "matched"],
  ["**/shared.ts", "shared.ts", "matched"],
  ["**/shared.ts", "components/base/interfaces/proof/tests/shared.ts", "matched"],
  ["bay/**/rule.ts", "bay/rule.ts", "matched"],
  ["components/**/tests/*.ts", "components/base/proof/tests/one.ts", "matched"],
  ["components/**/tests/*.ts", "components/base/proof/tests/deep/one.ts", "not matched"],
  ["**/**", "one", "matched"],
  ["bay/broker**", "bay/brokers.ts", "matched"],
  ["bay/broker**", "bay/broker/rule.ts", "not matched"],
  ["a**b/c", "a-and-b/c", "matched"],
  ["a**b/c", "a/b/c", "not matched"],
  ["src/*", "src/one/", "matched"],
  ["src/*", "src/one", "matched"],
  ["bay/broker/**", "bay/broker/rule.ts/", "matched"],
  ["./src/**", "src/one.ts", "matched"],
  ["src/**", "./src/one.ts", "matched"],
  ["./src/**", "./src/one.ts", "matched"],
  ["src/./one.ts", "src/one.ts", "matched"],
  [".", "README.md", "not matched"],
  ["Bay/**", "bay/sdk.ts", "not matched"],
  ["bay/SDK.ts", "bay/sdk.ts", "not matched"],
  ["", "src/one.ts", "not a pattern"],
  ["src/", "src/one.ts", "not a pattern"],
  ["src/**/", "src/one.ts", "not a pattern"],
  ["/src/**", "src/one.ts", "not a pattern"],
  ["src//one.ts", "src/one.ts", "not a pattern"],
  ["../src/**", "src/one.ts", "not a pattern"],
  ["src/a..b", "src/a..b", "not a pattern"],
  ["src/one two.ts", "src/one two.ts", "not a pattern"],
  ["src/a+b.ts", "src/a+b.ts", "not a pattern"],
  ["-src/**", "-src/one.ts", "not a pattern"],
  ["a".repeat(1001), "a".repeat(1001), "not a pattern"],
  ["a".repeat(1000), "a".repeat(1000), "matched"],
  ["src/**", "", "not a path"],
  ["src/**", "/src/one.ts", "not a path"],
  ["src/*/one.ts", "src/../one.ts", "not a path"],
  ["src/**", "src//one.ts", "not a path"],
  ["src/**", "./", "not a path"],
];

const sentence =
  "A path relative to the repository's root, or a pattern of paths. A * stands for any characters inside one folder or file name; a ** that is a whole part stands for any number of folders. bay/broker/** holds every file under bay/broker/, and not bay/brokers.ts.";

type PatternSchema = { readonly pattern: string; readonly maxLength: number; readonly description: string };

function fieldOf(value: unknown, name: string): unknown {
  return typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
}

function scopePattern(): PatternSchema {
  const file = join(kit, "components/base/interfaces/proof/prove-request.json");
  const schema: unknown = JSON.parse(readFileSync(file, "utf8"));
  const slice = fieldOf(fieldOf(schema, "$defs"), "slice");
  const scope = fieldOf(fieldOf(fieldOf(slice, "properties"), "scope"), "items");
  const pattern = fieldOf(scope, "pattern");
  const maxLength = fieldOf(scope, "maxLength");
  const description = fieldOf(scope, "description");
  assert.ok(typeof pattern === "string" && typeof maxLength === "number" && typeof description === "string");
  return { pattern, maxLength, description };
}

test("every case of the table gives the answer the table pins", () => {
  const answers = table.map(([pattern, path]) => pathMatch(pattern, path).kind);
  assert.deepEqual(
    answers,
    table.map(([, , kind]) => kind),
  );
  assert.ok(table.length >= 30);
});

test("the interface's sentence is the one the table was written from", () => {
  assert.equal(scopePattern().description, sentence);
});

test("the interface's pattern admits exactly the patterns the function calls patterns", () => {
  const scope = scopePattern();
  const expression = new RegExp(scope.pattern, "u");
  const admitted = table.map(([pattern]) => pattern.length <= scope.maxLength && expression.test(pattern));
  assert.deepEqual(
    admitted,
    table.map(([pattern]) => pathMatch(pattern, "one").kind !== "not a pattern"),
  );
});

test("a pattern that is not one, and a path that is not one, say why", () => {
  assert.deepEqual(pathMatch("src/", "src/one.ts"), {
    kind: "not a pattern",
    reason: '"src/" is not a pattern: it ends with /.',
  });
  assert.deepEqual(pathMatch("", "src/one.ts"), { kind: "not a pattern", reason: '"" is not a pattern: it is empty.' });
  assert.deepEqual(pathMatch("../src/**", "src/one.ts"), {
    kind: "not a pattern",
    reason: '"../src/**" is not a pattern: it holds two dots in a row.',
  });
  assert.deepEqual(pathMatch("src/one two.ts", "src/one.ts"), {
    kind: "not a pattern",
    reason: '"src/one two.ts" is not a pattern: it holds a character other than a letter, a digit, _, ., *, / and -.',
  });
  assert.deepEqual(pathMatch("src/**", "src/../one.ts"), {
    kind: "not a path",
    reason: '"src/../one.ts" is not a path: it holds .. as a part.',
  });
  assert.deepEqual(pathMatch("src/**", "/src/one.ts"), {
    kind: "not a path",
    reason: '"/src/one.ts" is not a path: it starts with /, and a path is relative to the repository\'s root.',
  });
});

test("a pattern of many stars against a long name answers at once", () => {
  const started = performance.now();
  assert.deepEqual(pathMatch(`${"a*".repeat(400)}b`, "a".repeat(5000)), { kind: "not matched" });
  assert.deepEqual(pathMatch(`${"**/".repeat(300)}x`, `${"a/".repeat(300)}y`), { kind: "not matched" });
  assert.ok(performance.now() - started < 2000);
});
