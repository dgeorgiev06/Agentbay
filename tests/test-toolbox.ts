import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse, stringify } from "yaml";
import type { Json, ModeList, RunEvent, Spend, StepPlace } from "../bay/contracts.ts";
import type { Config } from "../bay/generated/config.ts";
import type { Budget } from "../bay/generated/mode.ts";
import { fieldOf, isRecord, numberField, toJson } from "../bay/json.ts";
import { layoutOf } from "../bay/layout.ts";
import { loadKernel, nodeKernelPorts, type Kernel } from "../bay/kernel.ts";
import type { Outcome } from "../bay/outcome.ts";
import { listOf } from "../bay/policy.ts";
import type { Clock } from "../bay/ports.ts";
import type { DatabasePartition } from "../bay/sdk.ts";
import { readTrustRecord, recordWithTrust, scriptFilesOf, writeTrustRecord } from "../bay/trust.ts";
import { testEnvironment } from "./kernel-fixture.ts";
import { kit } from "./project-fixture.ts";
import { activeModeGrants } from "./system-fixture.ts";

export type CallOptions = {
  readonly caller?: string;
};

export type TestProject = {
  readonly project?: string;
  readonly trusted?: readonly string[];
};

export type ProjectOptions = TestProject & {
  readonly startAt?: string;
  readonly callers?: readonly string[];
};

type Task = {
  readonly token?: string;
  readonly input: Json;
  readonly round: number;
  readonly feedback: readonly string[];
};

type Waiting =
  | { readonly reason: "skill"; readonly stepKey: string; readonly task: Task }
  | {
      readonly reason: "approval";
      readonly stepKey: string;
      readonly question: string;
      readonly hash: string;
      readonly content: Json;
    }
  | { readonly reason: "time"; readonly stepKey: string; readonly until: string }
  | { readonly reason: "budget"; readonly stepKey: string }
  | { readonly reason: "owner"; readonly stepKey: string; readonly question: string };

type RunState =
  | { readonly status: "running" }
  | { readonly status: "waiting"; readonly waiting: Waiting }
  | { readonly status: "done"; readonly output: Json }
  | { readonly status: "failed"; readonly reason: string }
  | { readonly status: "undone"; readonly reason: string };

export type Run = {
  readonly id: string;
  readonly state: RunState;
  readonly spent: Spend;
  readonly events: readonly RunEvent[];
};

type ListedRun = {
  readonly id: string;
  readonly status: RunState["status"];
};

export type Decision = {
  readonly stepKey: string;
  readonly hash: string;
  readonly verdict: "approve" | "reject";
  readonly by: string;
};

export type ModeProject = {
  readonly root: string;
  readonly run: (reference: string, input: Json, options?: CallOptions) => Promise<Run>;
  readonly output: (reference: string, input: Json, options?: CallOptions) => Promise<Json>;
  readonly failure: (reference: string, input: Json, options?: CallOptions) => Promise<string>;
  readonly refusal: (reference: string, input: Json) => Promise<string>;
  readonly runWorkflow: (mode: string, path: string, input: Json) => Promise<Run>;
  readonly answer: (token: string, output: Json) => Promise<Run>;
  readonly answerRefusal: (token: string, output: Json) => Promise<string>;
  readonly approve: (runId: string, decision: Decision) => Promise<Run>;
  readonly extend: (runId: string, extra: Budget) => Promise<Run>;
  readonly runs: () => Promise<readonly ListedRun[]>;
  readonly partition: (mode: string, name: string) => DatabasePartition;
  readonly setTime: (time: string) => void;
  readonly reopen: (config: Config) => Promise<ModeProject>;
  readonly close: () => Promise<void>;
};

type SettableClock = Clock & {
  readonly set: (time: string) => void;
};

type Fields = Readonly<Record<string, unknown>>;

type Opening = {
  readonly config: Config;
  readonly projectConfig: Fields | undefined;
  readonly clock: SettableClock;
};

type ListToTrust = {
  readonly list: ModeList;
  readonly folder: string;
};

const calledInterface = "items-store";

const configFile = "agentbay.config.yaml";

const nothingSpent: Spend = { items: 0, usd: 0, tokens: 0, minutes: 0 };

const trustedBy = "a test";

function settableClock(startAt: string | undefined): SettableClock {
  let fixed = startAt === undefined ? undefined : Date.parse(startAt);
  return {
    now: () => (fixed === undefined ? new Date() : new Date(fixed)),
    set: (time) => {
      fixed = Date.parse(time);
    },
  };
}

function accepted<Value>(result: Outcome<Value>): Value {
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.problems, null, 2));
  return result.value;
}

function refusalOf<Value>(result: Outcome<Value>, what: string): string {
  assert.ok(!result.ok, `expected ${what} to be refused, got ${JSON.stringify(result)}`);
  return result.problems.map((problem) => problem.message).join(" ");
}

function trustSentence(untrusted: ReadonlySet<string>, reference: string): string {
  const mode = reference.split(".")[0] ?? "";
  return untrusted.has(mode)
    ? " A test runs the commands of a mode outside the kit's components/base/ only when it trusts the mode. " +
        `Name it where the test opens the project: { project: import.meta.dirname, trusted: ["${mode}"] }.`
    : "";
}

function outputOf(run: Run, untrusted: ReadonlySet<string>, reference: string): Json {
  if (run.state.status !== "done") {
    assert.fail(`expected the run to be done, got ${JSON.stringify(run.state)}.${trustSentence(untrusted, reference)}`);
  }
  return run.state.output;
}

function reasonOf(run: Run): string {
  if (run.state.status !== "failed") {
    assert.fail(`expected the run to fail, got ${JSON.stringify(run.state)}`);
  }
  return run.state.reason;
}

function partitionOf(kernel: Kernel, mode: string, name: string): DatabasePartition {
  const place: StepPlace = { runId: "test-toolbox", mode, action: "test-toolbox", stepKey: "test-toolbox" };
  const permissions = {
    grants: activeModeGrants(kernel.system, mode),
    actionEffects: ["read" as const, "write" as const],
  };
  const closing = async <T>(use: (opened: ReturnType<Kernel["brokerFor"]>) => Promise<T>): Promise<T> => {
    const opened = kernel.brokerFor(place, permissions);
    try {
      return await use(opened);
    } finally {
      opened.close();
    }
  };
  return {
    migrate: () => closing((opened) => opened.ask("db.migrate", { partition: name })),
    execute: (sql, parameters = []) =>
      closing((opened) => opened.ask("db.execute", { sql, parameters, partition: name })),
    query: (sql, parameters = []) => closing((opened) => opened.ask("db.query", { sql, parameters, partition: name })),
    agentQuery: (sql) => closing((opened) => opened.ask("db.agentQuery", { sql, partition: name })),
  };
}

async function callingManifest(name: string): Promise<Json> {
  const file = join(kit, "components/base/interfaces", `${calledInterface}.yaml`);
  const definition = toJson(parse(await readFile(file, "utf8")));
  const listed = fieldOf(definition, "actions");
  const actions = Object.entries(isRecord(listed) ? listed : {}).map(([action, signature]) => {
    const effects = fieldOf(toJson(signature), "effects") ?? [];
    const run = [{ call: `${calledInterface}.${action}` }];
    return [
      action,
      {
        description: `When a test calls ${action}.`,
        input: "schemas/any.json",
        output: "schemas/any.json",
        effects,
        run,
      },
    ] as const;
  });
  return {
    name,
    version: "1.0.0",
    description: `A fixture that calls each action of ${calledInterface} with one call step, as a mode does.`,
    requires: { interfaces: [`${calledInterface}@${String(numberField(definition, "version"))}`] },
    actions: Object.fromEntries(actions),
  };
}

async function writeCallingMode(root: string, name: string): Promise<void> {
  const folder = join(root, "components/modes", name);
  await mkdir(join(folder, "schemas"), { recursive: true });
  await writeFile(join(folder, "mode.yaml"), stringify(await callingManifest(name)), "utf8");
  await writeFile(join(folder, "schemas/any.json"), "{}\n", "utf8");
}

function calledAs(reference: string, caller: string): string {
  const prefix = `${calledInterface}.`;
  assert.ok(reference.startsWith(prefix), `a caller reaches only ${calledInterface}; ${reference} is not its action`);
  return `${caller}.${reference.slice(prefix.length)}`;
}

function projectRootAt(folder: string): string {
  const parent = dirname(folder);
  if (existsSync(join(folder, configFile))) {
    return folder;
  }
  assert.notEqual(parent, folder, `no folder at or above the one given holds ${configFile}`);
  return projectRootAt(parent);
}

async function configOf(project: string): Promise<Fields> {
  const config: unknown = parse(await readFile(join(project, configFile), "utf8"));
  return isRecord(config) ? config : {};
}

function fieldsAt(fields: Fields, key: string): Fields {
  const value = fields[key];
  return isRecord(value) ? value : {};
}

function namesAt(fields: Fields, key: string): readonly string[] {
  const value = fields[key];
  return Array.isArray(value) ? value.filter((name): name is string => typeof name === "string") : [];
}

function settingsOver(projectSettings: Fields, given: Fields): Fields {
  const modes = new Set([...Object.keys(projectSettings), ...Object.keys(given)]);
  return Object.fromEntries(
    [...modes].map((mode) => [mode, { ...fieldsAt(projectSettings, mode), ...fieldsAt(given, mode) }]),
  );
}

function configOver(projectConfig: Fields, given: Config): Fields {
  const modes = [...new Set([...namesAt(projectConfig, "modes"), ...(given.modes ?? [])])];
  return {
    ...projectConfig,
    ...given,
    bindings: { ...fieldsAt(projectConfig, "bindings"), ...given.bindings },
    settings: settingsOver(fieldsAt(projectConfig, "settings"), given.settings ?? {}),
    modes,
  };
}

export async function openModeProject(config: Config, options: ProjectOptions = {}): Promise<ModeProject> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentbay-modes-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  const project = options.project === undefined ? undefined : projectRootAt(resolve(options.project));
  if (project !== undefined) {
    await cp(join(project, "components"), join(root, "components"), { recursive: true });
  }
  for (const caller of options.callers ?? []) {
    await writeCallingMode(root, caller);
  }
  const projectConfig = project === undefined ? undefined : await configOf(project);
  const opening = { config, projectConfig, clock: settableClock(options.startAt) };
  const trusted = options.trusted ?? [];
  if (trusted.length > 0) {
    try {
      await trustIn(root, opening, trusted);
    } catch (error) {
      await rm(root, { recursive: true, force: true });
      throw error;
    }
  }
  return projectIn(root, opening);
}

async function kernelIn(root: string, opening: Opening): Promise<Kernel> {
  const { config, projectConfig, clock } = opening;
  const written = projectConfig === undefined ? config : configOver(projectConfig, config);
  await writeFile(join(root, configFile), stringify(written), "utf8");
  const loaded = await loadKernel({
    layout: layoutOf({ kit, project: root }),
    ports: { ...nodeKernelPorts(testEnvironment), clock },
    environment: testEnvironment,
    platform: "linux",
  });
  assert.ok(loaded.ok, loaded.ok ? "" : JSON.stringify(loaded.problems, null, 2));
  return loaded.value;
}

function listToTrust(kernel: Kernel, name: string): ListToTrust {
  const found = kernel.system.modes.get(name);
  if (found === undefined) {
    assert.fail(`trusted names ${name}, but the project the test opened has no active mode ${name}.`);
  }
  const list = listOf(found.manifest);
  if (list.commands.length === 0 && list.throwaway.length === 0) {
    assert.fail(`trusted names ${name}, but ${name} lists no command and no throwaway folder, so it needs no trust.`);
  }
  if (found.grants.listTrust.state === "not needed") {
    assert.fail(
      `trusted names ${name}, but ${name} is a mode of the kit's components/base/, whose list is granted with no trust.`,
    );
  }
  return { list, folder: found.grants.modeFolder };
}

async function giveTrust(kernel: Kernel, toTrust: ListToTrust): Promise<void> {
  const { files, folders, listing, clock } = kernel.ports;
  const record = accepted(await readTrustRecord(files, kernel.layout));
  const scripts = await scriptFilesOf(files, toTrust.folder, await listing.projectFiles(toTrust.folder));
  const giving = { scripts, at: clock.now().toISOString(), by: trustedBy };
  await writeTrustRecord({ files, folders }, kernel.layout, recordWithTrust(record, toTrust.list, giving));
}

async function trustIn(root: string, opening: Opening, trusted: readonly string[]): Promise<void> {
  const kernel = await kernelIn(root, opening);
  try {
    const lists = trusted.map((name) => listToTrust(kernel, name));
    for (const toTrust of lists) {
      await giveTrust(kernel, toTrust);
    }
  } finally {
    kernel.close();
  }
}

function untrustedModes(kernel: Kernel): ReadonlySet<string> {
  const modes = [...kernel.system.modes.values()];
  const untrusted = modes.filter((mode) => mode.grants.listTrust.state === "never trusted");
  return new Set(untrusted.map((mode) => mode.manifest.name));
}

async function projectIn(root: string, opening: Opening): Promise<ModeProject> {
  const kernel = await kernelIn(root, opening);
  const { projectConfig, clock } = opening;
  const untrusted = untrustedModes(kernel);
  const runs = kernel.runs;
  const started = (reference: string, input: Json, options: CallOptions = {}): Promise<Outcome<Run>> => {
    const action = options.caller === undefined ? reference : calledAs(reference, options.caller);
    return runs.start({ action }, input);
  };
  const run = async (reference: string, input: Json, options?: CallOptions): Promise<Run> =>
    accepted(await started(reference, input, options));
  return {
    root,
    run,
    output: async (reference, input, options) => outputOf(await run(reference, input, options), untrusted, reference),
    failure: async (reference, input, options) => reasonOf(await run(reference, input, options)),
    refusal: async (reference, input) => refusalOf(await started(reference, input), reference),
    runWorkflow: async (mode, path, input) => accepted(await runs.start({ workflow: { mode, path } }, input)),
    answer: async (token, output) => accepted(await runs.submit(token, { output, spent: nothingSpent })),
    answerRefusal: async (token, output) =>
      refusalOf(await runs.submit(token, { output, spent: nothingSpent }), "the answer"),
    approve: async (runId, decision) => accepted(await runs.approve(runId, decision)),
    extend: async (runId, extra) => accepted(await runs.extend(runId, extra)),
    runs: async () => (await runs.list()).map((listed) => ({ id: listed.id, status: listed.status })),
    partition: (mode, name) => partitionOf(kernel, mode, name),
    setTime: clock.set,
    reopen: async (changed) => {
      kernel.close();
      return projectIn(root, { config: changed, projectConfig, clock });
    },
    close: async () => {
      kernel.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
