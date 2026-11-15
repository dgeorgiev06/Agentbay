import assert from "node:assert/strict";
import { test } from "node:test";
import { commentLineNumbers } from "../bay/check-limits.ts";
import { check, cleanFiles, findFinding, limitsText, withoutFinding } from "./check-fixture.ts";

const limitsFile = "framework/limits.yaml";

function lines(...text: readonly string[]): string {
  return `${text.join("\n")}\n`;
}

function ceilings(changes: Readonly<Record<string, number | string>>): string {
  const entries = limitsText
    .trim()
    .split("\n")
    .map((line) => line.split(": "))
    .map(([measure = "", value = ""]) => [measure, String(changes[measure] ?? value)]);
  return lines(...entries.map(([measure, value]) => `${String(measure)}: ${String(value)}`));
}

test("a comment marker inside a string is not a comment", () => {
  assert.deepEqual(commentLineNumbers(lines('const a = "//";', "const b = '/* no */';", 'const c = "a\\"//";')), []);
});

test("a line comment and a one-line block comment are counted, after code too", () => {
  const text = lines("// first", "const a = 1; /* note */", "const b = 2; // trailing", "const c = 3;");
  assert.deepEqual(commentLineNumbers(text), [1, 2, 3]);
});

test("a block comment spanning lines counts every line it touches", () => {
  const text = lines("const a = 1;", "/*", " * text", " */", "const b = 2;");
  assert.deepEqual(commentLineNumbers(text), [2, 3, 4]);
});

test("a URL in a template literal, nested interpolations and regular expressions are not comments", () => {
  const text = lines(
    "const url = `https://example.com/${path}//x`;",
    'const nested = `a ${`b ${"//"}`} ${ { key: "/*" }.key } c`;',
    "const pattern = /\\/\\//g;",
    "const klass = /[/]/;",
    "const ratio = total / count;",
    "const after = `${ratio}`; // real",
  );
  assert.deepEqual(commentLineNumbers(text), [6]);
});

test("a template literal spanning lines with // inside is not a comment", () => {
  const text = lines("const text = `", "  //  not a comment", "  ${value}", "`;", "/* yes */");
  assert.deepEqual(commentLineNumbers(text), [5]);
});

test("a shebang line is not a comment", () => {
  assert.deepEqual(commentLineNumbers(lines("#!/usr/bin/env node", "const a = 1;")), []);
});

test("each measure over its ceiling is a warning that gives the count and the ceiling", async () => {
  const report = await check({
    ...cleanFiles(),
    "bay/a.ts": lines("const a = 1;", "const b = 2;", "export { a, b };"),
    "bay/generated/types.ts": lines("1", "2", "3", "4", "5"),
    "adapters/one/a.ts": lines("1", "2"),
    "adapters/one/b.ts": lines("1", "2"),
    "adapters/two/a.ts": lines("1", "2", "3"),
    "schemas/mode.schema.json": "{}",
    "schemas/skill.schema.json": "{}",
    "schemas/notes.json": "{}",
    [limitsFile]: ceilings({ kernel_lines: 2, adapter_lines: 3, concepts: 1, top_level_folders: 4 }),
  });
  const expected = [
    ["kernel_lines is 3, over its ceiling of 2.", 1],
    ["adapter_lines is 4, over its ceiling of 3.", 2],
    ["concepts is 2, over its ceiling of 1.", 3],
    ["top_level_folders is 5, over its ceiling of 4.", 5],
  ] as const;
  for (const [message, line] of expected) {
    const finding = findFinding(report, limitsFile, message);
    assert.equal(finding.severity, "warning");
    assert.equal(finding.line, line);
    assert.match(finding.fix ?? "", /never outranks readability/);
  }
  assert.equal(report.errors, 0);
});

test("measures at their ceilings give no finding", async () => {
  const report = await check({ ...cleanFiles(), "bay/a.ts": lines("const a = 1;", "export { a };") });
  withoutFinding(report, "over its ceiling");
});

test("comment lines in kit code are an error naming each file and line", async () => {
  const report = await check({
    ...cleanFiles(),
    "bay/a.ts": lines("const a = 1;", "// why", "export { a };"),
    "components/modes/notes/scripts/tidy.ts": lines("/* one", "two */"),
    "tests/a.test.ts": lines("// tests are not counted"),
  });
  const kernel = findFinding(report, "bay/a.ts", "bay/a.ts has comment lines at 2; comment_lines is 3 in all");
  assert.equal(kernel.severity, "error");
  assert.equal(kernel.line, 2);
  findFinding(report, "components/modes/notes/scripts/tidy.ts", "has comment lines at 1, 2; comment_lines is 3 in all");
  assert.match(kernel.message, /over its ceiling of 0\./);
  withoutFinding(report, "tests/a.test.ts");
});

test("a missing limits file is reported", async () => {
  const files = Object.fromEntries(Object.entries(cleanFiles()).filter(([path]) => path !== limitsFile));
  const report = await check(files);
  findFinding(report, limitsFile, "framework/limits.yaml does not exist.");
});

test("an unknown measure, a missing measure and a ceiling that is not a whole number are reported", async () => {
  const text = `${ceilings({ concepts: "many" }).replace("cli_commands: 12\n", "")}bay_lines: 9703\n`;
  const report = await check({ ...cleanFiles(), [limitsFile]: text });
  findFinding(report, limitsFile, "framework/limits.yaml names bay_lines, which is not a measure.");
  findFinding(report, limitsFile, "framework/limits.yaml gives no ceiling for cli_commands.");
  const notWhole = findFinding(report, limitsFile, "The ceiling of concepts must be a whole number of 0 or more.");
  assert.equal(notWhole.line, 3);
});

test("a limits file that is not a mapping, or not YAML, is reported", async () => {
  const list = await check({ ...cleanFiles(), [limitsFile]: "- kernel_lines\n" });
  findFinding(list, limitsFile, "framework/limits.yaml is not a mapping of measure to ceiling.");
  const broken = await check({ ...cleanFiles(), [limitsFile]: "kernel_lines: [\n" });
  findFinding(broken, limitsFile, "The YAML cannot be read");
});
