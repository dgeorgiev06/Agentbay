import assert from "node:assert/strict";
import { test } from "node:test";
import { check, cleanFiles, findFinding, withoutFinding } from "./check-fixture.ts";

const script = "components/modes/notes/scripts/tidy.ts";

async function checkScript(text: string): ReturnType<typeof check> {
  return check({ ...cleanFiles(), [script]: text });
}

test("mode code may import bay/sdk.ts, node: built-ins and files of its own mode", async () => {
  const text = [
    'import { defineScript } from "../../../../bay/sdk.ts";',
    'import { join } from "node:path";',
    'import type { Note } from "./types.ts";',
    'export { helper } from "../schemas/helper.ts";',
    "",
  ].join("\n");
  const report = await checkScript(text);
  withoutFinding(report, "imports");
});

test("mode code importing another mode's file is reported with the resolved path", async () => {
  const report = await checkScript('import { put } from "../../../base/store/scripts/put.ts";\n');
  const finding = findFinding(
    report,
    script,
    "imports ../../../base/store/scripts/put.ts, which resolves to components/base/store/scripts/put.ts, " +
      "outside the mode folder components/modes/notes",
  );
  assert.equal(finding.line, 1);
});

test("mode code importing a kernel file other than bay/sdk.ts is reported", async () => {
  const report = await checkScript('const a = 1;\nimport {\n  loadSystem,\n} from "../../../../bay/registry.ts";\n');
  const finding = findFinding(report, script, "which resolves to bay/registry.ts");
  assert.equal(finding.line, 2);
});

test("a bare package import in mode code is reported", async () => {
  const report = await checkScript('import { parse } from "yaml";\nimport fs from "fs";\n');
  findFinding(report, script, "imports the package yaml; mode code has no dependencies in 5.0.0.");
  findFinding(report, script, "imports the package fs;");
});

test("export from, side-effect imports and absolute paths are scanned too", async () => {
  const report = await checkScript('export * from "../../todo/x.ts";\nimport "/etc/hook.ts";\n');
  findFinding(report, script, "which resolves to components/modes/todo/x.ts");
  findFinding(report, script, "imports /etc/hook.ts, which resolves to /etc/hook.ts");
});

test("a dynamic import is scanned, and one with a computed specifier is reported", async () => {
  const text = 'const a = await import("../../store/x.ts");\nconst b = await import(`./${name}.ts`);\n';
  const report = await checkScript(text);
  findFinding(report, script, "which resolves to components/modes/store/x.ts");
  const computed = findFinding(report, script, "calls import() with a specifier that is not a plain string");
  assert.equal(computed.line, 2);
});

test("an import cycle among kernel files is reported once", async () => {
  const report = await check({
    ...cleanFiles(),
    "bay/alpha.ts": 'import { b } from "./beta.ts";\n',
    "bay/beta.ts": 'import { c } from "./gamma.ts";\n',
    "bay/gamma.ts": 'import type { A } from "./alpha.ts";\n',
    "bay/delta.ts": 'import { a } from "./alpha.ts";\n',
  });
  const cycles = report.findings.filter((finding) => finding.message.includes("in a cycle"));
  assert.deepEqual(
    cycles.map((finding) => finding.message),
    ["Kernel files import each other in a cycle: bay/alpha.ts -> bay/beta.ts -> bay/gamma.ts -> bay/alpha.ts."],
  );
  assert.equal(cycles[0]?.file, "bay/alpha.ts");
});

test("a kernel file importing cli.ts, mcp.ts or an adapter is reported, and cli.ts may", async () => {
  const report = await check({
    ...cleanFiles(),
    "bay/engine.ts": 'import { main } from "./cli.ts";\nimport { serve } from "./mcp.ts";\n',
    "bay/policy.ts": 'import { hook } from "../adapters/claude-code/hook.ts";\n',
    "bay/cli.ts": 'import { hook } from "../adapters/claude-code/hook.ts";\nimport { serve } from "./mcp.ts";\n',
  });
  findFinding(report, "bay/engine.ts", "bay/engine.ts imports bay/cli.ts; the kernel core never imports cli.ts");
  findFinding(report, "bay/engine.ts", "bay/engine.ts imports bay/mcp.ts");
  findFinding(report, "bay/policy.ts", "imports adapters/claude-code/hook.ts");
  assert.ok(!report.findings.some((finding) => finding.file === "bay/cli.ts"));
});

test("an import written inside a string is still seen, as the scan's stated limit", async () => {
  const report = await checkScript('const text = `import { a } from "yaml"`;\n');
  findFinding(report, script, "imports the package yaml");
});
