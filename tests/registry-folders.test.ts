import assert from "node:assert/strict";
import { test } from "node:test";
import type { Config } from "../bay/generated/config.ts";
import type { Mode } from "../bay/generated/mode.ts";
import { layoutOf } from "../bay/layout.ts";
import { loadSystemReport, servingMode, type SystemReport } from "../bay/manifests/registry.ts";
import type { Problem } from "../bay/outcome.ts";
import { fakeFileSystem } from "./fakes.ts";
import { briefingMode, config, paths, schemaText, validFiles, yamlText } from "./system-fixture.ts";

const layout = layoutOf({ kit: "/kit", project: "/project" });

const journalMode: Mode = {
  name: "journal",
  version: "1.0.0",
  description: "Keeps a journal and writes each entry as a note.",
  requires: { interfaces: ["notes@1"] },
  actions: {
    write: {
      description: "When the owner writes an entry.",
      input: "schemas/write-input.json",
      output: "schemas/write-output.json",
      effects: ["read", "write"],
      run: [{ script: "scripts/write.ts" }, { call: "notes.add" }],
    },
  },
};

const projectConfig: Config = { bindings: { "items-store": "store", notes: "notes" }, adapter: "local" };

function without(files: Readonly<Record<string, string>>, ...removed: readonly string[]): Record<string, string> {
  return Object.fromEntries(Object.entries(files).filter(([path]) => !removed.includes(path)));
}

function kitFiles(): Record<string, string> {
  const kit = without(validFiles(), paths.config);
  return Object.fromEntries(Object.entries(kit).map(([path, text]) => [`/kit/${path}`, text]));
}

function projectFiles(changes: Partial<Config> = {}): Record<string, string> {
  return {
    "/project/agentbay.config.yaml": yamlText({ ...projectConfig, ...changes }),
    "/project/components/modes/journal/mode.yaml": yamlText(journalMode),
    "/project/components/modes/journal/schemas/write-input.json": schemaText("write-input"),
    "/project/components/modes/journal/schemas/write-output.json": schemaText("write-output"),
    "/project/components/modes/journal/scripts/write.ts": "",
  };
}

async function reportOf(files: Readonly<Record<string, string>>): Promise<SystemReport> {
  return loadSystemReport(fakeFileSystem(files), layout);
}

function problemsIn(report: SystemReport): readonly Problem[] {
  assert.ok(!report.outcome.ok, "expected the system to be refused");
  return report.outcome.problems;
}

function messages(problems: readonly Problem[]): string {
  return JSON.stringify(problems, null, 2);
}

test("a kit mode and a project mode are loaded together, each knowing its home and absolute folder", async () => {
  const report = await reportOf({ ...kitFiles(), ...projectFiles() });
  assert.ok(report.outcome.ok, report.outcome.ok ? "" : messages(report.outcome.problems));
  const system = report.outcome.value;
  assert.deepEqual([...system.modes.keys()].sort(), ["journal", "notes", "store"]);
  assert.deepEqual([...system.inactive], ["briefing"]);
  assert.deepEqual([...system.modes.values()].map((mode) => [mode.manifest.name, mode.home, mode.folder]).sort(), [
    ["journal", "project", "/project/components/modes/journal"],
    ["notes", "kit", "/kit/components/modes/notes"],
    ["store", "kit", "/kit/components/base/store"],
  ]);
  assert.equal(servingMode(system, "briefing", "notes@1"), "notes");
  assert.equal(system.interfaces.get("notes@1")?.file, "/kit/components/base/interfaces/notes.yaml");
});

test("the project's own interfaces come from its components/interfaces folder", async () => {
  const definition = { name: "diary", version: 1, actions: {} };
  const files = { ...kitFiles(), ...projectFiles(), "/project/components/interfaces/diary.yaml": yamlText(definition) };
  const report = await reportOf(files);
  assert.ok(report.outcome.ok, report.outcome.ok ? "" : messages(report.outcome.problems));
  assert.equal(report.outcome.value.interfaces.get("diary@1")?.file, "/project/components/interfaces/diary.yaml");
});

test("a project mode with the name of a kit mode is refused, naming both files", async () => {
  const shadow = { ...journalMode, name: "notes", requires: { interfaces: ["items-store@1"] } };
  const files = {
    ...kitFiles(),
    ...projectFiles(),
    "/project/components/modes/notes/mode.yaml": yamlText({ ...shadow, actions: {} }),
  };
  const problems = problemsIn(await reportOf(files));
  const duplicate = problems.find((problem) => problem.message.startsWith("Two modes are named notes"));
  assert.ok(duplicate, messages(problems));
  assert.equal(duplicate.file, "components/modes/notes/mode.yaml");
  assert.equal(
    duplicate.message,
    "Two modes are named notes: kit:components/modes/notes/mode.yaml and components/modes/notes/mode.yaml.",
  );
});

test("a project mode that shares its name with a kit mode that does not load is refused too", async () => {
  const files = {
    ...kitFiles(),
    ...projectFiles(),
    "/kit/components/modes/todo/mode.yaml": "apiVersion: agentbay/v4\nkind: Mode\n",
    "/project/components/modes/todo/mode.yaml": yamlText({ ...journalMode, name: "todo", requires: {} }),
  };
  const problems = problemsIn(await reportOf(files));
  assert.ok(
    problems.some((problem) => problem.message.includes("kit:components/modes/todo/mode.yaml and components/modes")),
    messages(problems),
  );
});

test("the active set holds the project's modes and the modes their bindings reach, and nothing else", async () => {
  const report = await reportOf({ ...kitFiles(), ...projectFiles() });
  assert.deepEqual([...report.active].sort(), ["journal", "notes", "store"]);
  assert.ok(report.outcome.ok);
  assert.deepEqual([...report.outcome.value.modes.keys()].sort(), ["journal", "notes", "store"]);
});

test("a kit mode listed under modes is active, and so is what it reaches", async () => {
  const settings = { briefing: { lookback: "3d" } };
  const report = await reportOf({ ...kitFiles(), ...projectFiles({ modes: ["briefing"], settings }) });
  assert.ok(report.outcome.ok, report.outcome.ok ? "" : messages(report.outcome.problems));
  assert.deepEqual([...report.active].sort(), ["briefing", "journal", "notes", "store"]);
});

test("with no project modes and nothing listed, no mode is active", async () => {
  const files = { ...kitFiles(), "/project/agentbay.config.yaml": yamlText(projectConfig) };
  const report = await reportOf(files);
  assert.ok(report.outcome.ok, report.outcome.ok ? "" : messages(report.outcome.problems));
  assert.deepEqual([...report.active], []);
  assert.equal(report.outcome.value.modes.size, 0);
  assert.deepEqual([...report.outcome.value.inactive].sort(), ["briefing", "notes", "store"]);
});

test("in the kit itself every mode is active", async () => {
  const kitAsProject = layoutOf({ kit: "/kit", project: "/kit" });
  const files = { ...kitFiles(), "/kit/agentbay.config.yaml": yamlText(config) };
  const report = await loadSystemReport(fakeFileSystem(files), kitAsProject);
  assert.deepEqual([...report.active].sort(), ["briefing", "notes", "store"]);
});

test("a listed mode that does not exist is reported in the config", async () => {
  const problems = problemsIn(await reportOf({ ...kitFiles(), ...projectFiles({ modes: ["diary"] }) }));
  assert.deepEqual(
    problems.map((problem) => [problem.file, problem.path, problem.message]),
    [["agentbay.config.yaml", "/modes/0", "modes lists diary, which is not a mode of the kit or of the project."]],
  );
});

test("forge outside the kit can be neither listed nor reached through a binding", async () => {
  const forgeMode: Mode = { name: "forge", version: "1.0.0", description: "Changes the kit.", actions: {} };
  const forgeFiles = { "/kit/components/base/forge/mode.yaml": yamlText({ ...forgeMode, implements: ["notes@1"] }) };
  const listed = problemsIn(await reportOf({ ...kitFiles(), ...forgeFiles, ...projectFiles({ modes: ["forge"] }) }));
  assert.ok(
    listed.some(
      (problem) =>
        problem.message === "modes lists forge, which can be active only when the project is the kit itself.",
    ),
    messages(listed),
  );
  const bindings = { ...projectConfig.bindings, notes: "forge" };
  const bound = await reportOf({ ...kitFiles(), ...forgeFiles, ...projectFiles({ bindings }) });
  assert.ok(!bound.active.has("forge"));
  const problems = problemsIn(bound);
  assert.ok(
    problems.some((problem) => problem.message.startsWith("bindings binds notes to forge, which can be active only")),
    messages(problems),
  );
  const inKit = layoutOf({ kit: "/kit", project: "/kit" });
  const kitConfig = { "/kit/agentbay.config.yaml": yamlText({ ...config, modes: ["forge"] }) };
  const kitReport = await loadSystemReport(fakeFileSystem({ ...kitFiles(), ...forgeFiles, ...kitConfig }), inKit);
  assert.ok(kitReport.active.has("forge"));
});

test("an inactive mode's binding, settings and file problems are not reported until it is listed", async () => {
  const broken = { ...briefingMode, requires: { interfaces: ["missing@1"] } };
  const files = {
    ...without(kitFiles(), "/kit/components/modes/briefing/scripts/select.ts"),
    "/kit/components/modes/briefing/mode.yaml": yamlText(broken),
  };
  const settings = { briefing: { lookback: "three days" } };
  const quiet = await reportOf({ ...files, ...projectFiles({ settings }) });
  assert.ok(quiet.outcome.ok, quiet.outcome.ok ? "" : messages(quiet.outcome.problems));
  const listed = problemsIn(await reportOf({ ...files, ...projectFiles({ settings, modes: ["briefing"] }) }));
  const text = messages(listed);
  assert.ok(text.includes("Mode briefing requires missing@1"), text);
  assert.ok(text.includes("kit:components/modes/briefing/scripts/select.ts does not exist"), text);
  assert.ok(
    listed.some((problem) => problem.path === "/settings/briefing/lookback"),
    text,
  );
});

test("a kit mode that fails its schema is a notice while inactive and a problem once listed", async () => {
  const files = { ...kitFiles(), "/kit/components/modes/todo/mode.yaml": "apiVersion: agentbay/v4\nkind: Mode\n" };
  const inactive = await reportOf({ ...files, ...projectFiles() });
  assert.ok(inactive.outcome.ok, inactive.outcome.ok ? "" : messages(inactive.outcome.problems));
  assert.equal(inactive.notices.length, 1);
  const [notice] = inactive.notices;
  assert.ok(notice);
  assert.equal(notice.file, "kit:components/modes/todo/mode.yaml");
  assert.match(notice.message, /^Mode todo of the kit does not load \(\d+ problems; the first: /);
  assert.match(notice.message, /It is not active in this project, so the project does not use it\.$/);
  const listed = problemsIn(await reportOf({ ...files, ...projectFiles({ modes: ["todo"] }) }));
  assert.ok(
    listed.some((problem) => problem.file === "kit:components/modes/todo/mode.yaml" && problem.path === ""),
    messages(listed),
  );
  assert.ok(
    listed.some((problem) => problem.message.includes("has the field apiVersion")),
    messages(listed),
  );
});
