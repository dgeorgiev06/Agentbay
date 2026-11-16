import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { EventSink, Json, ScriptRequest, ScriptRunner, Spend, StepOutcome, Submission } from "../bay/contracts.ts";
import type { Config } from "../bay/generated/config.ts";
import type { Interface } from "../bay/generated/interface.ts";
import type { Action, Mode } from "../bay/generated/mode.ts";
import type { Workflow } from "../bay/generated/workflow.ts";
import { fieldOf, numberField, textField } from "../bay/json.ts";
import { layoutOf } from "../bay/layout.ts";
import { loadSystemReport, type System } from "../bay/manifests/manifests.ts";
import type { Outcome } from "../bay/outcome.ts";
import { openRuns, type Run, type Runs, type Task } from "../bay/runs/runs.ts";
import { SecretStore } from "../bay/secrets.ts";
import { noProcesses } from "./broker-fixture.ts";
import { fakeClock, fakeFileSystem, fakeFolders, type FakeFileSystem } from "./fakes.ts";
import { activeModeGrants, yamlText } from "./system-fixture.ts";

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

export type FixtureSystem = {
  readonly system: System;
  readonly files: FakeFileSystem;
};

export type Opening = {
  readonly scripts?: Readonly<Record<string, Script>>;
  readonly changes?: Changes;
  readonly toolCallsPerRound?: number;
  readonly secretHandedOut?: "at open" | "later";
};

export type OpenedRuns = FixtureSystem & {
  readonly runs: Runs;
  readonly runner: FakeRunner;
  readonly clock: ReturnType<typeof fakeClock>;
  readonly database: string;
  readonly createdBeforeRunner: readonly string[];
  readonly sink: () => EventSink;
  readonly reopen: (system?: System) => Promise<Runs>;
  readonly handOutSecret: () => Promise<void>;
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

export function crashingOnce(answered: Script): Script {
  let calls = 0;
  return (request) => {
    calls += 1;
    if (calls === 1) {
      throw new Error("the process died");
    }
    return answered(request);
  };
}

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
    description: "When a test runs scripts.",
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
      description: "When a mode keeps an item.",
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
    description: "When a test stores one item.",
    input: "schemas/item.json",
    output: "schemas/receipt.json",
    effects: ["read", "write"],
    run: [{ call: "items-store.put" }],
  },
  "store-then-fail": {
    description: "When a test stores an item and then fails.",
    input: "schemas/item.json",
    output: "schemas/anything.json",
    effects: ["read", "write"],
    run: [{ call: "items-store.put" }, { script: "scripts/fail.ts" }],
  },
  peek: { ...scriptAction(["read"], []), run: [{ call: "items-store.get" }] },
  budgeted: {
    description: "When a test spends from a budget.",
    input: "schemas/anything.json",
    output: "schemas/anything.json",
    effects: ["read", "write", "spend"],
    run: [{ script: "scripts/spend.ts" }, { call: "items-store.put" }, { script: "scripts/spend.ts" }],
    budget: { items: 5 },
  },
  draft: {
    description: "When a test drafts a text.",
    input: "schemas/anything.json",
    output: "schemas/draft.json",
    effects: ["read"],
    run: [{ skill: "skills/draft", tier: "balanced", checks: ["scripts/long-enough.ts"] }],
  },
  "draft-and-store": {
    description: "When a test drafts a text and stores it.",
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
  const outcome = (await loadSystemReport(files, layout)).outcome;
  assert.ok(outcome.ok, outcome.ok ? "" : JSON.stringify(outcome.problems, null, 2));
  return { system: outcome.value, files };
}

function secretStore(): SecretStore {
  const environment = { [`AGENTBAY_SECRET_${secretName}`]: secretValue };
  return new SecretStore({ environment, processes: noProcesses, platform: "linux" });
}

async function handOut(scrubber: SecretStore, system: System): Promise<void> {
  const handedOut = await scrubber.get(secretName, activeModeGrants(system, "notes"));
  assert.ok(handedOut.ok);
}

export async function fixtureScrubber(system: System): Promise<SecretStore> {
  const scrubber = secretStore();
  await handOut(scrubber, system);
  return scrubber;
}

function closedOnce(runs: Runs): Runs {
  let closed = false;
  return {
    ...runs,
    close: () => {
      if (!closed) {
        closed = true;
        runs.close();
      }
    },
  };
}

function projectFolder(): { readonly project: string; readonly remove: () => void } {
  const project = mkdtempSync(join(tmpdir(), "agentbay-runs-"));
  mkdirSync(join(project, ".agentbay"));
  const remove = (): void => {
    rmSync(project, { recursive: true, force: true });
  };
  return { project, remove };
}

export async function openedRuns(opening: Opening = {}): Promise<OpenedRuns> {
  const { project, remove } = projectFolder();
  const fixture = await fixtureSystem(opening.changes);
  const { files } = fixture;
  const scrubber = secretStore();
  const handOutSecret = (): Promise<void> => handOut(scrubber, fixture.system);
  if (opening.secretHandedOut !== "later") {
    await handOutSecret();
  }
  const folders = fakeFolders();
  const clock = fakeClock(startTime);
  const runner = fakeRunner(opening.scripts);
  const createdBeforeRunner: string[] = [];
  const sinks: EventSink[] = [];
  const opened: Runs[] = [];
  const reopen = async (system: System = fixture.system): Promise<Runs> => {
    const runs = await openRuns({
      project,
      folders,
      files,
      clock,
      system,
      scrubber,
      toolCallsPerRound: opening.toolCallsPerRound ?? 200,
      runner: (events) => {
        createdBeforeRunner.push(...folders.created);
        sinks.push(events);
        return runner;
      },
    });
    const once = closedOnce(runs);
    opened.push(once);
    return once;
  };
  const runs = await reopen();
  const sink = (): EventSink => {
    const first = sinks[0];
    assert.ok(first);
    return first;
  };
  const close = (): void => {
    for (const each of opened) {
      each.close();
    }
    remove();
  };
  const database = join(project, ".agentbay/kernel.db");
  return { ...fixture, runs, runner, clock, database, createdBeforeRunner, sink, reopen, handOutSecret, close };
}

export function runOf(result: Outcome<Run>): Run {
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.problems, null, 2));
  return result.value;
}

export function problemsOf(result: Outcome<unknown>): readonly string[] {
  assert.ok(!result.ok, `expected a refusal, got ${JSON.stringify(result)}`);
  return result.problems.map((problem) => problem.message);
}

export function messagesOf(result: Outcome<unknown>): string {
  return problemsOf(result).join(" ");
}

export function waitingOf(result: Outcome<Run>): Extract<Run["state"], { readonly status: "waiting" }>["waiting"] {
  const state = runOf(result).state;
  assert.ok(state.status === "waiting", JSON.stringify(state));
  return state.waiting;
}

export function waitingTask(run: Run): Task {
  const state = run.state;
  assert.ok(state.status === "waiting" && state.waiting.reason === "skill", JSON.stringify(state));
  return state.waiting.task;
}

export function tokenOf(run: Run): string {
  const token = waitingTask(run).token;
  assert.ok(token !== undefined, "the task carries no token");
  return token;
}

export function spentAt(run: Run, stepKey: string): Spend {
  const finishedAt = run.events.find(
    (event) => event.kind === "step.finished" && textField(event.detail, "stepKey") === stepKey,
  );
  const spent = finishedAt === undefined ? undefined : fieldOf(finishedAt.detail, "spent");
  assert.ok(spent !== undefined, `step ${stepKey} has no step.finished event with its spend`);
  return {
    items: numberField(spent, "items") ?? 0,
    usd: numberField(spent, "usd") ?? 0,
    tokens: numberField(spent, "tokens") ?? 0,
    minutes: numberField(spent, "minutes") ?? 0,
  };
}

export function eventKinds(run: Run): readonly string[] {
  return run.events.map((event) => event.kind);
}
