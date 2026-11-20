import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const loaded: unknown = createRequire(import.meta.url)("../eslint.config.js");

function entriesOf(module: unknown): readonly unknown[] {
  const config = typeof module === "object" && module !== null && "default" in module ? module.default : undefined;
  return Array.isArray(config) ? config : [];
}

function isFor(entry: object, files: string): boolean {
  return "files" in entry && Array.isArray(entry.files) && entry.files.length === 1 && entry.files[0] === files;
}

function rulesOf(entry: unknown, files: string): readonly (readonly [string, unknown])[] {
  if (typeof entry !== "object" || entry === null || !isFor(entry, files) || !("rules" in entry)) {
    return [];
  }
  const { rules } = entry;
  return typeof rules === "object" && rules !== null ? Object.entries(rules) : [];
}

function ruleFor(files: string, rule: string): unknown {
  const rules = entriesOf(loaded).flatMap((entry) => rulesOf(entry, files));
  return rules.filter(([name]) => name === rule).at(-1)?.[1];
}

test("an empty block, an empty catch among them, is an error for every TypeScript file of the kit (TS-24)", () => {
  assert.deepEqual(ruleFor("**/*.ts", "no-empty"), ["error", { allowEmptyCatch: false }]);
});
