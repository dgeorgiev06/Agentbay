import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint, Linter } from "eslint";
import { parser } from "typescript-eslint";

const loaded: unknown = createRequire(import.meta.url)("../components/base/typescript/eslint.config.js");

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

const kit = fileURLToPath(new URL("..", import.meta.url));

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

const livingRule = "agentbay/no-living-documents";

const livingMessage = (document: string): string =>
  `A test reads ${document}, a living document of the owner's that changes as he signs new versions: ` +
  "copy what the test needs into the test's fixtures and read it from there.";

function isPlugin(value: unknown): value is ESLint.Plugin {
  return typeof value === "object" && value !== null && "rules" in value;
}

function agentbayPlugin(): ESLint.Plugin {
  const found = entriesOf(loaded).flatMap((entry) => {
    const plugins = typeof entry === "object" && entry !== null && "plugins" in entry ? entry.plugins : undefined;
    const plugin =
      typeof plugins === "object" && plugins !== null && "agentbay" in plugins ? plugins.agentbay : undefined;
    return isPlugin(plugin) ? [plugin] : [];
  });
  const [plugin] = found;
  assert.ok(plugin !== undefined);
  return plugin;
}

async function pluginRuleFor(name: string, file: string): Promise<Linter.RuleEntry> {
  const config: unknown = await kitLint.calculateConfigForFile(file);
  const rules = typeof config === "object" && config !== null && "rules" in config ? config.rules : undefined;
  const rule: unknown = typeof rules === "object" && rules !== null ? Reflect.get(rules, name) : undefined;
  return isRuleEntry(rule) ? rule : "off";
}

async function pluginMessages(name: string, file: string, code: string): Promise<readonly string[]> {
  const only = {
    files: ["**/*.ts"],
    languageOptions: { parser },
    plugins: { agentbay: agentbayPlugin() },
    rules: { [name]: await pluginRuleFor(name, file) },
  };
  return new Linter({ configType: "flat", cwd: kit })
    .verify(code, [only], { filename: join(kit, file) })
    .map((found) => found.message);
}

function livingRuleFor(file: string): Promise<Linter.RuleEntry> {
  return pluginRuleFor(livingRule, file);
}

function livingMessages(file: string, code: string): Promise<readonly string[]> {
  return pluginMessages(livingRule, file, code);
}

const theOneTest = "components/base/requirements/tests/check.test.ts";

const judgedFiles = [
  "components/modes/notes/tests/probe.test.ts",
  "components/base/forge/tests/lib/probe.ts",
  "tests/probe.test.ts",
  "tests/probe-fixture.ts",
  "bay/probe.test.ts",
];

const livingReads: readonly (readonly [string, string])[] = [
  [
    'const text = readFileSync(join(import.meta.dirname, "..", "..", "docs/requirements/todo.yaml"), "utf8");',
    "docs/requirements/todo.yaml",
  ],
  [
    'const file = join(import.meta.dirname, "../..", "docs", "designs", "todo/design.yaml");',
    "docs/designs/todo/design.yaml",
  ],
  [
    'const kit = join(import.meta.dirname, "../.."); const plan = join(kit, "docs", "plans", "0024-forge-whole.yaml");',
    "docs/plans/0024-forge-whole.yaml",
  ],
  ['const url = new URL("../../../../docs/plans/README.md", import.meta.url);', "docs/plans/README.md"],
  [
    'const kit = fileURLToPath(new URL("../../../..", import.meta.url)); const at = join(kit, "docs/plans/0025-todo.yaml");',
    "docs/plans/0025-todo.yaml",
  ],
  [
    'const file = "docs/requirements/todo.yaml"; const url = new URL(`../../../../${file}`, import.meta.url);',
    "docs/requirements/todo.yaml",
  ],
  ['const at = resolve(import.meta.dirname + "/../docs/requirements/lamp.yaml");', "docs/requirements/lamp.yaml"],
  [
    'const folder = "docs/requirements"; const at = join(import.meta.dirname, "..", folder, "todo.yaml");',
    "docs/requirements/todo.yaml",
  ],
];

test("a test file or a helper of a tests folder may not read the owner's requirements, designs or plans from the kit", async () => {
  for (const file of judgedFiles) {
    for (const [code, document] of livingReads) {
      assert.deepEqual(await livingMessages(file, code), [livingMessage(document)], `${file}: ${code}`);
    }
  }
});

test("a test may read its fixtures, other documents of the kit, and name those paths inside a project it made", async () => {
  const allowed = [
    'const text = join(import.meta.dirname, "..", "..", "..", "..", "tests", "fixtures", "todo-v1.yaml");',
    'const adr = join(import.meta.dirname, "..", "docs/adr/0029-roles.md");',
    'const at = join(project.root, "docs/requirements/todo.yaml");',
    'await mkdir(join(root, "docs", "plans"), { recursive: true });',
    'const file = "docs/requirements/todo.yaml";',
    'const text = git(root, ["show", "integration:docs/designs/todo/design.yaml"]);',
  ];
  for (const file of judgedFiles) {
    for (const code of allowed) {
      assert.deepEqual(await livingMessages(file, code), [], `${file}: ${code}`);
    }
  }
});

test("the one test the rule names may read the owner's todo requirements, and nothing else that lives", async () => {
  const live =
    'const kit = join(import.meta.dirname, "..", "..", "..", ".."); const at = join(kit, "docs/requirements/todo.yaml");';
  assert.deepEqual(await livingMessages(theOneTest, live), []);
  const other = 'const at = join(import.meta.dirname, "..", "..", "..", "..", "docs/requirements/lamp.yaml");';
  assert.deepEqual(await livingMessages(theOneTest, other), [livingMessage("docs/requirements/lamp.yaml")]);
  assert.deepEqual(await livingMessages("components/base/forge/tests/probe.test.ts", live), [
    livingMessage("docs/requirements/todo.yaml"),
  ]);
});

test("code outside the tests is not judged by the rule against living documents", async () => {
  const read = 'const at = join(import.meta.dirname, "..", "docs/requirements/todo.yaml");';
  for (const file of ["components/base/forge/scripts/probe.ts", "bay/probe.ts", "adapters/claude-code/probe.ts"]) {
    assert.equal(await livingRuleFor(file), "off", file);
    assert.deepEqual(await livingMessages(file, read), [], file);
  }
});

const copyRule = "agentbay/kit-copied-in-one-place";

const copyMessage =
  "A test lists or copies the kit itself: make the copy with copyKitInto or copyOfTheKit from " +
  "tests/test-toolbox.ts, which leaves the owner's living documents out of every copy.";

const forgeTest = "components/base/forge/tests/probe.test.ts";

const kitCopies: readonly string[] = [
  'const top = fileURLToPath(new URL("../../../..", import.meta.url)); execFileSync("git", ["ls-files", "-z"], { cwd: top });',
  'const root = join(import.meta.dirname, "..", "..", "..", ".."); spawnSync("git", ["archive", "HEAD"], { cwd: root });',
  'run(kit, "git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);',
  'git(template, ["clone", "-q", kitFolder, "."]);',
  'git(kitRoot, ["worktree", "add", "-q", folder, "main"]);',
  "await cp(kit, folder, { recursive: true });",
  'const top = new URL("../../../..", import.meta.url); cpSync(top, folder, { recursive: true });',
];

test("a test file or a helper of a tests folder may not list or copy the kit itself", async () => {
  for (const code of kitCopies) {
    assert.deepEqual(await pluginMessages(copyRule, forgeTest, code), [copyMessage], code);
  }
});

test("a test may list and copy its own projects, copy single files of the kit, and run bay in the kit", async () => {
  const allowed = [
    'git(root, ["ls-files"]);',
    'git(template, ["worktree", "add", "-q", "--detach", folder, head]);',
    'await cp(join(kit, "components/base/forge/README.md"), join(root, "README.md"));',
    'spawnSync(process.execPath, [join(kitFolder, "bay", "cli.ts"), "check", "--json"], { cwd: kitFolder });',
    'const forge = join(import.meta.dirname, ".."); execFileSync("git", ["ls-files"], { cwd: forge });',
  ];
  for (const code of allowed) {
    assert.deepEqual(await pluginMessages(copyRule, forgeTest, code), [], code);
  }
});

test("only the test toolbox lists and copies the kit, and tests/lint-ignores.test.ts lists its code to lint it", async () => {
  const listing =
    'execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: kitRoot });';
  assert.deepEqual(await pluginMessages(copyRule, "tests/test-toolbox.ts", listing), []);
  assert.deepEqual(await pluginMessages(copyRule, "tests/lint-ignores.test.ts", listing), []);
  assert.deepEqual(await pluginMessages(copyRule, "tests/kit-copy.ts", listing), [copyMessage]);
  assert.equal(await pluginRuleFor(copyRule, "components/base/forge/scripts/probe.ts"), "off");
});
