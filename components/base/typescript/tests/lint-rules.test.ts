import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint, Linter } from "eslint";
import { parser } from "typescript-eslint";

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

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

const kitLint = new ESLint({ cwd: kit, overrideConfigFile: "components/base/typescript/eslint.config.js" });

const clockMessage = "A mode script reads the time with context.now(), which a step run again gets back unchanged.";

const randomMessage =
  "A mode script draws random values with context.random(bytes), which a step run again gets back unchanged.";

function isRuleEntry(value: unknown): value is Linter.RuleEntry {
  return Array.isArray(value) && (value[0] === "error" || value[0] === 2);
}

async function syntaxRule(file: string): Promise<Linter.RuleEntry> {
  const config: unknown = await kitLint.calculateConfigForFile(file);
  const rules = typeof config === "object" && config !== null && "rules" in config ? config.rules : undefined;
  const rule =
    typeof rules === "object" && rules !== null && "no-restricted-syntax" in rules
      ? rules["no-restricted-syntax"]
      : undefined;
  return isRuleEntry(rule) ? rule : "off";
}

async function syntaxMessages(file: string, code: string): Promise<readonly string[]> {
  const only = {
    files: ["**/*.ts"],
    languageOptions: { parser },
    rules: { "no-restricted-syntax": await syntaxRule(file) },
  };
  return new Linter({ configType: "flat" })
    .verify(code, [only], { filename: "probe.ts" })
    .map((found) => found.message);
}

const scriptFile = "components/modes/notes/scripts/lib/probe.ts";

test("a mode script may not read the clock or draw random values itself, and is pointed at its context", async () => {
  const banned: readonly (readonly [string, string])[] = [
    ["const at = Date.now();", clockMessage],
    ["const at = new Date();", clockMessage],
    ["const at = Date();", clockMessage],
    ["const pick = Math.random();", randomMessage],
    ["const mark = randomBytes(16);", randomMessage],
    ["const id = crypto.randomUUID();", randomMessage],
    ["globalThis.crypto.getRandomValues(new Uint8Array(4));", randomMessage],
    ['import { randomInt } from "node:crypto";', randomMessage],
    ['import { randomFillSync as fill } from "crypto";', randomMessage],
  ];
  for (const [code, message] of banned) {
    assert.deepEqual(await syntaxMessages(scriptFile, code), [message], code);
  }
});

test("a mode script may use its context's clock and random, a given time and a hash, and a test may use the clock", async () => {
  const allowed = [
    "const at = context.now();",
    "const mark = await context.random(16);",
    'const at = new Date("2026-11-21T00:00:00Z");',
    "const at = new Date(value);",
    'import { createHash } from "node:crypto";',
  ];
  for (const code of allowed) {
    assert.deepEqual(await syntaxMessages(scriptFile, code), [], code);
  }
  assert.deepEqual(await syntaxMessages("components/modes/notes/tests/probe.test.ts", "Date.now();"), []);
});
