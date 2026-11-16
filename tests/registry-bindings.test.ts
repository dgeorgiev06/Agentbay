import assert from "node:assert/strict";
import { test } from "node:test";
import type { Config } from "../bay/generated/config.ts";
import type { Mode } from "../bay/generated/mode.ts";
import { layoutOf } from "../bay/layout.ts";
import { bindingUses, type System } from "../bay/manifests/manifests.ts";
import type { Problem } from "../bay/outcome.ts";
import { fakeFileSystem } from "./fakes.ts";
import {
  paths,
  schemaText,
  storeMode,
  systemReport,
  validFiles,
  yamlText,
  type SystemReport,
} from "./system-fixture.ts";

function servingModeOf(system: System, caller: string, call: string): string | undefined {
  const answer = system.action(call, caller);
  return answer.ok ? answer.value.mode.manifest.name : undefined;
}

const layout = layoutOf({ kit: "/kit", project: "/project" });

const ledgerMode: Mode = {
  name: "ledger",
  version: "1.0.0",
  description: "Keeps a ledger in the store.",
  requires: { interfaces: ["items-store@1"] },
  actions: {
    record: {
      description: "When an entry goes into the ledger.",
      input: "schemas/record-input.json",
      output: "schemas/record-output.json",
      effects: ["read", "write"],
      run: [{ call: "items-store.put" }],
    },
  },
};

const journalMode: Mode = {
  name: "journal",
  version: "1.0.0",
  description: "Writes each entry as a note.",
  requires: { interfaces: ["notes@1"] },
  actions: {
    write: {
      description: "When the owner writes an entry.",
      input: "schemas/write-input.json",
      output: "schemas/write-output.json",
      effects: ["read", "write"],
      run: [{ call: "notes.add" }],
    },
  },
};

type Binding = Config["bindings"][string];

function kitFiles(vault: Mode | "broken" = { ...storeMode, name: "vault" }): Record<string, string> {
  const kit = Object.fromEntries(Object.entries(validFiles()).filter(([path]) => path !== paths.config));
  for (const [path, text] of Object.entries(kit)) {
    if (path.startsWith("components/base/store/")) {
      kit[path.replace("components/base/store/", "components/base/vault/")] = text;
    }
  }
  kit["components/base/vault/mode.yaml"] = vault === "broken" ? "name: vault\nversion: one\n" : yamlText(vault);
  return Object.fromEntries(Object.entries(kit).map(([path, text]) => [`/kit/${path}`, text]));
}

function projectMode(mode: Mode): Record<string, string> {
  const folder = `/project/components/modes/${mode.name}`;
  const files: Record<string, string> = { [`${folder}/mode.yaml`]: yamlText(mode) };
  for (const action of Object.values(mode.actions)) {
    files[`${folder}/${action.input}`] = schemaText("input");
    files[`${folder}/${action.output}`] = schemaText("output");
  }
  return files;
}

type Setup = {
  readonly itemsStore: Binding;
  readonly withJournal?: boolean;
  readonly vault?: Mode | "broken";
};

async function reportOf(setup: Setup): Promise<SystemReport> {
  const config: Config = { bindings: { "items-store": setup.itemsStore, notes: "notes" }, adapter: "local" };
  const files = {
    ...kitFiles(setup.vault),
    ...projectMode(ledgerMode),
    ...(setup.withJournal === false ? {} : projectMode(journalMode)),
    "/project/agentbay.config.yaml": yamlText(config),
  };
  return systemReport(fakeFileSystem(files), layout);
}

function problemsOf(report: SystemReport): readonly Problem[] {
  assert.ok(!report.outcome.ok, "expected the system to be refused");
  return report.outcome.problems;
}

function onlyProblem(report: SystemReport): Problem {
  const problems = problemsOf(report);
  assert.equal(problems.length, 1, JSON.stringify(problems, null, 2));
  const [problem] = problems;
  assert.ok(problem);
  return problem;
}

test("a map binds one interface to a different mode for each requiring mode", async () => {
  const report = await reportOf({ itemsStore: { notes: "store", ledger: "vault" } });
  assert.ok(report.outcome.ok, report.outcome.ok ? "" : JSON.stringify(report.outcome.problems, null, 2));
  const system = report.outcome.value;
  assert.equal(servingModeOf(system, "notes", "items-store.put"), "store");
  assert.equal(servingModeOf(system, "ledger", "items-store.put"), "vault");
  assert.equal(servingModeOf(system, "journal", "items-store.put"), undefined);
  assert.deepEqual(bindingUses(system), [
    { interfaceName: "items-store", requirers: ["ledger"], servedBy: "vault" },
    { interfaceName: "items-store", requirers: ["notes"], servedBy: "store" },
    { interfaceName: "notes", requirers: ["journal"], servedBy: "notes" },
  ]);
  assert.deepEqual([...report.active].sort(), ["journal", "ledger", "notes", "store", "vault"]);
});

test("default serves every requiring mode the map does not name", async () => {
  const report = await reportOf({ itemsStore: { ledger: "vault", default: "store" } });
  assert.ok(report.outcome.ok, report.outcome.ok ? "" : JSON.stringify(report.outcome.problems, null, 2));
  assert.equal(servingModeOf(report.outcome.value, "notes", "items-store.put"), "store");
  assert.equal(servingModeOf(report.outcome.value, "ledger", "items-store.put"), "vault");
});

test("a requiring mode with no entry and no default is not bound, and the problem names it", async () => {
  const problem = onlyProblem(await reportOf({ itemsStore: { ledger: "vault" } }));
  assert.equal(problem.path, "/bindings/items-store");
  assert.equal(
    problem.message,
    "Mode notes requires items-store@1, but bindings.items-store has no entry for notes and no default.",
  );
  assert.equal(
    problem.fix,
    "Add notes: <mode> or default: <mode> under bindings.items-store; " +
      "modes that implement items-store@1: store, vault.",
  );
});

test("an entry for a mode that does not require the interface is a stale entry", async () => {
  const problem = onlyProblem(await reportOf({ itemsStore: { notes: "store", ledger: "vault", journal: "store" } }));
  assert.equal(problem.path, "/bindings/items-store/journal");
  assert.equal(
    problem.message,
    "bindings.items-store has an entry for journal, but mode journal does not require items-store.",
  );
});

test("a map key that is not a mode is reported", async () => {
  const problem = onlyProblem(await reportOf({ itemsStore: { notes: "store", ledger: "vault", ghost: "store" } }));
  assert.equal(problem.path, "/bindings/items-store/ghost");
  assert.equal(problem.message, "bindings.items-store has an entry for ghost, which is not a mode.");
});

test("an entry bound to no mode, or to a mode that does not implement the interface, names the requirer", async () => {
  const missing = onlyProblem(await reportOf({ itemsStore: { notes: "store", ledger: "nobody" } }));
  assert.equal(missing.path, "/bindings/items-store/ledger");
  assert.equal(missing.message, "bindings binds items-store for ledger to nobody, which is not a mode.");
  const wrong = problemsOf(await reportOf({ itemsStore: { notes: "store", default: "journal" } }));
  assert.deepEqual(
    wrong.map((problem) => [problem.path, problem.message]),
    [
      [
        "/bindings/items-store/default",
        "bindings binds items-store for ledger to journal, which does not implement items-store@1, " +
          "as mode ledger requires.",
      ],
    ],
  );
});

test("an entry bound to a kit mode that does not load says so", async () => {
  const report = await reportOf({ itemsStore: { notes: "store", ledger: "vault" }, vault: "broken" });
  const problems = problemsOf(report);
  const problem = problems.find((entry) => entry.path === "/bindings/items-store/ledger");
  assert.ok(problem, JSON.stringify(problems, null, 2));
  assert.equal(
    problem.message,
    "bindings binds items-store for ledger to vault, which does not load; its own problems are listed.",
  );
});

test("the active set follows each requirer's entry: a mode bound for an inactive requirer stays inactive", async () => {
  const report = await reportOf({ itemsStore: { notes: "store", ledger: "vault" }, withJournal: false });
  assert.ok(report.outcome.ok, report.outcome.ok ? "" : JSON.stringify(report.outcome.problems, null, 2));
  assert.deepEqual([...report.active].sort(), ["ledger", "vault"]);
});

test("a cycle is found along each requirer's own entry, and none is reported where the entries avoid it", async () => {
  const vault = { ...storeMode, name: "vault", requires: { interfaces: ["notes@1"] } };
  const cyclic = problemsOf(await reportOf({ itemsStore: { notes: "vault", ledger: "store" }, vault }));
  assert.deepEqual(
    cyclic.map((problem) => problem.message),
    ["Modes depend on each other in a cycle through bindings: notes -> vault -> notes."],
  );
  const acyclic = await reportOf({ itemsStore: { notes: "store", ledger: "vault" }, vault });
  assert.ok(acyclic.outcome.ok, acyclic.outcome.ok ? "" : JSON.stringify(acyclic.outcome.problems, null, 2));
});
