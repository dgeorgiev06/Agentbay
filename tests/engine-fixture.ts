import assert from "node:assert/strict";
import type { Json, PolicyOf, ScriptRequest, ScriptRunner, Spend, StepOutcome, Submission } from "../bay/contracts.ts";
import { Engine } from "../bay/runs/engine.ts";
import type { Config } from "../bay/generated/config.ts";
import type { Interface } from "../bay/generated/interface.ts";
import type { Action, Mode } from "../bay/generated/mode.ts";
import type { Workflow } from "../bay/generated/workflow.ts";
import { numberField, textField } from "../bay/json.ts";
import { layoutOf } from "../bay/layout.ts";
import { loadPolicedSystem, policyFor } from "../bay/policy.ts";
import type { System } from "../bay/registry.ts";
import type { RunStore } from "../bay/runs/run-store.ts";
import { SqliteRunStore } from "../bay/runs/sqlite-run-store.ts";
import type { RunView, Waiting } from "../bay/runs/run-state.ts";
import type { Outcome } from "../bay/outcome.ts";
import { SecretStore } from "../bay/secrets.ts";
import { noProcesses } from "./broker-fixture.ts";
import { fakeClock, fakeFileSystem, type FakeFileSystem } from "./fakes.ts";
import { temporaryKernelDb, type KernelDb } from "./kernel-db-fixture.ts";
import { yamlText } from "./system-fixture.ts";

export type Script = (request: ScriptRequest) => StepOutcome | Promise<StepOutcome>;

export type FakeRunner = ScriptRunner & {
  readonly calls: ScriptRequest[];
  readonly runsOf: (script: string) => readonly ScriptRequest[];
};

export type Changes = {
  readonly workflows?: Readonly<Record<string, Workflow>>;
  readonly notesActions?: Readonly<Record<string, Action>>;
  readonly config?: Partial<Config>;
};

type FreshEngine = {
  readonly system?: System;
  readonly store?: RunStore;
  readonly owner?: string;
};

export type FixtureSystem = {
  readonly system: System;
  readonly policyOf: PolicyOf;
  readonly files: FakeFileSystem;
};

export type Harness = FixtureSystem & {
  readonly engine: Engine;
  readonly store: SqliteRunStore;
  readonly file: string;
  readonly reopen: () => SqliteRunStore;
  readonly runner: FakeRunner;
  readonly clock: ReturnType<typeof fakeClock>;
  readonly scrubber: SecretStore;
  readonly freshEngine: (options?: FreshEngine) => Engine;
  readonly close: () => void;
};

export const startTime = new Date("2026-11-14T09:00:00.000Z");

const root = "/kit";

const layout = layoutOf({ kit: root, project: root });

const secretName = "NOTES_TOKEN";

export const secretValue = "notes-token-7f3a9c2e";

const noSpend: Spend = { items: 0, usd: 0, tokens: 0, minutes: 0 };

export const notesFlow = { mode: "notes", path: "workflows/flow.yaml" };

export function withFlow(
  steps: Workflow["steps"],
): Changes & { readonly workflows: Readonly<Record<string, Workflow>> } {
  return { workflows: { [notesFlow.path]: { name: "flow", steps } } };
}

export function finished(output: Json, spent: Partial<Spend> = {}): StepOutcome {
  return { status: "done", output, spent: { ...noSpend, ...spent } };
}

export function answer(output: Json, spent: Partial<Spend> = {}): Submission {
  return { output, spent: { ...noSpend, ...spent } };
}

export function failure(reason: string): StepOutcome {
  return { status: "failed", reason, spent: noSpend };
}

function countOf(input: Json): number {
  return numberField(input, "count") ?? 0;
}

function measureOf(input: Json): keyof Spend {
  const measure = textField(input, "measure");
  return measure === "usd" || measure === "tokens" || measure === "minutes" ? measure : "items";
}

const defaultScripts: Readonly<Record<string, Script>> = {
  "notes:scripts/add-one.ts": (request) => finished({ count: countOf(request.input) + 1 }),
  "notes:scripts/double.ts": (request) => finished({ count: countOf(request.input) * 2 }),
  "notes:scripts/stringify.ts": () => finished({ count: "five" }),
  "notes:scripts/log.ts": (request) => finished(request.input),
  "notes:scripts/slow.ts": (request) => finished(request.input),
  "notes:scripts/fail.ts": () => failure("the script gave up"),
  "notes:scripts/spend.ts": (request) => finished(request.input, { [measureOf(request.input)]: 1 }),
  "notes:scripts/long-enough.ts": (request) => {
    const text = textField(request.input, "text") ?? "";
    return finished(text.length >= 10 ? { passed: true } : { passed: false, feedback: `too short: ${text}` });
  },
  "store:scripts/put.ts": (request) => finished({ id: textField(request.input, "id") ?? "" }, { items: 2 }),
  "store:scripts/get.ts": (request) => finished(request.input),
  "store:scripts/erase.ts": (request) => finished({ id: textField(request.input, "id") ?? "" }),
  "store:scripts/remove.ts": (request) => finished(request.input),
};

export function fakeRunner(overrides: Readonly<Record<string, Script>> = {}): FakeRunner {
  const scripts = { ...defaultScripts, ...overrides };
  const calls: ScriptRequest[] = [];
  return {
    calls,
    runsOf: (script) => calls.filter((call) => `${call.place.mode}:${call.script}` === script),
    run: async (request) => {
      calls.push(request);
      const script = scripts[`${request.place.mode}:${request.script}`];
      assert.ok(script, `the fake runner has no script ${request.place.mode}:${request.script}`);
      return script(request);
    },
  };
}

const schemas: Readonly<Record<string, unknown>> = {
  "anything.json": {},
  "count.json": {
    type: "object",
    additionalProperties: false,
    required: ["count"],
    properties: { count: { type: "integer" } },
  },
  "draft.json": {
    type: "object",
    required: ["text"],
    properties: { text: { type: "string", minLength: 1 } },
  },
  "item.json": { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  "receipt.json": { type: "object", required: ["id"], properties: { id: { type: "string" } } },
  "settings.json": { type: "object", properties: { greeting: { type: "string" } } },
};

function schemaFiles(folder: string, names: readonly string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => [`${folder}/${name}`, JSON.stringify(schemas[name])]));
}

const itemsStore: Interface = {
  name: "items-store",
  version: 1,
  actions: {
    put: { input: "items-store/item.json", output: "items-store/receipt.json", effects: ["write"] },
    get: { input: "items-store/anything.json", output: "items-store/anything.json", effects: ["read"] },
    erase: { input: "items-store/item.json", output: "items-store/receipt.json", effects: ["write", "delete"] },
  },
};

function scriptAction(effects: Action["effects"], scripts: readonly string[], schema = "anything.json"): Action {
  return {
    input: `schemas/${schema}`,
    output: `schemas/${schema}`,
    effects,
    run: scripts.map((script) => ({ script: `scripts/${script}` })),
  };
}

const storeMode: Mode = {
  name: "store",
  version: "1.0.0",
  description: "Keeps items.",
  implements: ["items-store@1"],
  actions: {
    put: {
      input: "schemas/item.json",
      output: "schemas/receipt.json",
      effects: ["write"],
      run: [{ script: "scripts/put.ts" }],
      undo: "remove",
      budget: { items: 10 },
    },
    get: scriptAction(["read"], ["get.ts"]),
    erase: {
      ...scriptAction(["write", "delete"], ["erase.ts"]),
      input: "schemas/item.json",
      output: "schemas/receipt.json",
    },
    remove: scriptAction(["delete"], ["remove.ts"]),
  },
};

const notesActions: Readonly<Record<string, Action>> = {
  copy: scriptAction(["read"], ["add-one.ts", "double.ts", "add-one.ts"], "count.json"),
  save: scriptAction(["read", "write"], ["add-one.ts", "double.ts", "add-one.ts"], "count.json"),
  broken: { ...scriptAction(["read"], ["stringify.ts"]), output: "schemas/count.json" },
  log: scriptAction(["write"], ["log.ts"]),
  spend: scriptAction(["read", "spend"], ["spend.ts", "spend.ts", "spend.ts"]),
  long: scriptAction(["read"], ["slow.ts", "slow.ts", "slow.ts", "slow.ts", "slow.ts", "slow.ts"]),
  "store-one": {
    input: "schemas/item.json",
    output: "schemas/receipt.json",
    effects: ["read", "write"],
    run: [{ call: "items-store.put" }],
  },
  "store-then-fail": {
    input: "schemas/item.json",
    output: "schemas/anything.json",
    effects: ["read", "write"],
    run: [{ call: "items-store.put" }, { script: "scripts/fail.ts" }],
  },
  peek: { ...scriptAction(["read"], []), run: [{ call: "items-store.get" }] },
  budgeted: {
    input: "schemas/anything.json",
    output: "schemas/anything.json",
    effects: ["read", "write", "spend"],
    run: [{ script: "scripts/spend.ts" }, { call: "items-store.put" }, { script: "scripts/spend.ts" }],
    budget: { items: 5 },
  },
  draft: {
    input: "schemas/anything.json",
    output: "schemas/draft.json",
    effects: ["read"],
    run: [{ skill: "skills/draft", tier: "balanced", checks: ["scripts/long-enough.ts"] }],
  },
  "draft-and-store": {
    input: "schemas/anything.json",
    output: "schemas/receipt.json",
    effects: ["read", "write"],
    run: [{ skill: "skills/draft", tier: "fast" }, { call: "items-store.put" }],
  },
};

const draftSkill = [
  "---",
  "name: draft",
  "description: Writes a short draft.",
  "metadata:",
  "  output: schemas/draft.json",
  "---",
  "",
  "## Input",
  "",
].join("\n");

const scriptNames = ["add-one", "double", "stringify", "log", "fail", "spend", "long-enough", "slow"];

function fixtureFiles(changes: Changes): Record<string, string> {
  const workflows = changes.workflows ?? {};
  const notesMode: Mode = {
    name: "notes",
    version: "1.0.0",
    description: "Writes notes and keeps them in the store.",
    requires: { interfaces: ["items-store@1"] },
    settings: "schemas/settings.json",
    resources: { secrets: [secretName] },
    actions: { ...notesActions, ...(changes.notesActions ?? {}) },
    ...(Object.keys(workflows).length === 0 ? {} : { workflows: Object.keys(workflows) }),
  };
  const config: Config = {
    bindings: { "items-store": "store" },
    adapter: "local",
    settings: { notes: { greeting: "hello" } },
    ...(changes.config ?? {}),
  };
  const files: Record<string, string> = {
    "components/base/interfaces/items-store.yaml": yamlText(itemsStore),
    ...schemaFiles("components/base/interfaces/items-store", ["anything.json", "item.json", "receipt.json"]),
    "components/base/store/mode.yaml": yamlText(storeMode),
    ...schemaFiles("components/base/store/schemas", ["anything.json", "item.json", "receipt.json"]),
    "components/modes/notes/mode.yaml": yamlText(notesMode),
    ...schemaFiles("components/modes/notes/schemas", Object.keys(schemas)),
    "components/modes/notes/skills/draft/SKILL.md": draftSkill,
    "agentbay.config.yaml": yamlText(config),
  };
  for (const name of ["put", "get", "erase", "remove"]) {
    files[`components/base/store/scripts/${name}.ts`] = "";
  }
  for (const name of scriptNames) {
    files[`components/modes/notes/scripts/${name}.ts`] = "";
  }
  for (const [path, workflow] of Object.entries(workflows)) {
    files[`components/modes/notes/${path}`] = yamlText(workflow);
  }
  return Object.fromEntries(Object.entries(files).map(([path, text]) => [`${root}/${path}`, text]));
}

export async function fixtureSystem(changes: Changes = {}): Promise<FixtureSystem> {
  const files = fakeFileSystem(fixtureFiles(changes));
  const outcome = (await loadPolicedSystem(files, layout)).outcome;
  assert.ok(outcome.ok, outcome.ok ? "" : JSON.stringify(outcome.problems, null, 2));
  return { ...outcome.value, files };
}

export function policyOfSystem(system: System): PolicyOf {
  const policy = policyFor(system, layout);
  assert.ok(policy.ok, policy.ok ? "" : JSON.stringify(policy.problems, null, 2));
  return policy.value;
}

export async function fixtureScrubber(policyOf: PolicyOf): Promise<SecretStore> {
  const environment = { [`AGENTBAY_SECRET_${secretName}`]: secretValue };
  const scrubber = new SecretStore({ environment, processes: noProcesses, platform: "linux" });
  const handedOut = await scrubber.get(secretName, policyOf("notes"));
  assert.ok(handedOut.ok);
  return scrubber;
}

function kernelFile(file: string | undefined): KernelDb {
  return file === undefined ? temporaryKernelDb() : { file, remove: () => undefined };
}

export async function harness(
  options: {
    readonly scripts?: Readonly<Record<string, Script>>;
    readonly changes?: Changes;
    readonly file?: string;
  } = {},
): Promise<Harness> {
  const fixture = await fixtureSystem(options.changes);
  const { system, policyOf, files } = fixture;
  const kernelDb = kernelFile(options.file);
  const opened: SqliteRunStore[] = [];
  const reopen = (): SqliteRunStore => {
    const store = new SqliteRunStore(kernelDb.file);
    opened.push(store);
    return store;
  };
  const store = reopen();
  const scrubber = await fixtureScrubber(policyOf);
  const runner = fakeRunner(options.scripts);
  const clock = fakeClock(startTime);
  let engines = 0;
  const freshEngine = (fresh: FreshEngine = {}): Engine => {
    engines += 1;
    return new Engine({
      system: fresh.system ?? system,
      store: fresh.store ?? store,
      runner,
      policyOf: fresh.system === undefined ? policyOf : policyOfSystem(fresh.system),
      clock,
      files,
      scrubber,
      owner: fresh.owner ?? `engine-${String(engines)}`,
      newId: () => `run-${String(engines)}`,
    });
  };
  const close = (): void => {
    for (const each of opened) {
      each.close();
    }
    kernelDb.remove();
  };
  return {
    ...fixture,
    engine: freshEngine(),
    store,
    file: kernelDb.file,
    reopen,
    runner,
    clock,
    scrubber,
    freshEngine,
    close,
  };
}

export function runOf(result: Outcome<RunView>): RunView {
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.problems, null, 2));
  return result.value;
}

export function waitingOf(result: Outcome<RunView>): Waiting {
  const run = runOf(result);
  assert.equal(run.state.status, "waiting", JSON.stringify(run.state));
  return run.state.waiting;
}

export function problemsOf(result: Outcome<RunView>): readonly string[] {
  assert.ok(!result.ok, `expected a refusal, got ${JSON.stringify(result)}`);
  return result.problems.map((problem) => problem.message);
}

export async function eventKinds(store: RunStore, runId: string): Promise<readonly string[]> {
  return (await store.readEvents(runId)).map((event) => event.kind);
}
