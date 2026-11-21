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

const modeFiles = [
  "components/modes/notes/scripts/lib/probe.ts",
  "components/base/forge/scripts/probe.ts",
  "components/base/forge/zzlib/stamp.ts",
];

const testFiles = ["components/modes/notes/tests/probe.test.ts", "components/base/forge/tests/lib/probe.ts"];

const banned: readonly (readonly [string, string])[] = [
  ["const at = Date.now();", clockMessage],
  ["const at = globalThis.Date.now();", clockMessage],
  ['const at = Date["now"]();', clockMessage],
  ["const at = new Date();", clockMessage],
  ["const at = new globalThis.Date();", clockMessage],
  ["const at = Date();", clockMessage],
  ["const D = Date;", clockMessage],
  ["const { now } = Date;", clockMessage],
  ["const pick = Math.random();", randomMessage],
  ["const pick = globalThis.Math.random();", randomMessage],
  ['const pick = Math["random"]();', randomMessage],
  ["const { random } = Math;", randomMessage],
  ["const mark = randomBytes(16);", randomMessage],
  ["const id = crypto.randomUUID();", randomMessage],
  ['const id = crypto["randomUUID"]();', randomMessage],
  ["const { getRandomValues } = globalThis.crypto;", randomMessage],
  ["const { randomBytes } = crypto;", randomMessage],
  ["globalThis.crypto.getRandomValues(new Uint8Array(4));", randomMessage],
  ['import { randomInt } from "node:crypto";', randomMessage],
  ['import { randomFillSync as fill } from "crypto";', randomMessage],
];

test("a mode's code outside its tests, base modes and helpers beside scripts/ too, may not read the clock or draw random values itself", async () => {
  for (const file of modeFiles) {
    for (const [code, message] of banned) {
      const found = await syntaxMessages(file, code);
      assert.ok(found.length > 0 && found.every((each) => each === message), `${file}: ${code}: ${found.join("; ")}`);
    }
  }
});

test("a mode's code may use its context's clock and random, a given time and a hash, and its tests may use the clock", async () => {
  const allowed = [
    "const at = context.now();",
    "const mark = await context.random(16);",
    'const at = new Date("2026-11-21T00:00:00Z");',
    "const at = new Date(value);",
    "const day = Date.UTC(2026, 10, 21);",
    'import { createHash } from "node:crypto";',
  ];
  for (const file of modeFiles) {
    for (const code of allowed) {
      assert.deepEqual(await syntaxMessages(file, code), [], `${file}: ${code}`);
    }
  }
  for (const file of testFiles) {
    assert.deepEqual(await syntaxMessages(file, "Date.now(); Math.random();"), [], file);
  }
});
