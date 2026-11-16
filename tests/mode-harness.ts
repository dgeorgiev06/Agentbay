import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import type { Json, StepPlace } from "../bay/contracts.ts";
import type { Config } from "../bay/generated/config.ts";
import { fieldOf, isRecord, numberField, toJson } from "../bay/json.ts";
import { layoutOf } from "../bay/layout.ts";
import { loadKernel, nodeKernelPorts, type Kernel } from "../bay/kernel.ts";
import type { Outcome } from "../bay/outcome.ts";
import type { Clock } from "../bay/ports.ts";
import type { Run } from "../bay/runs/runs.ts";
import type { DatabasePartition } from "../bay/sdk.ts";
import { testEnvironment } from "./kernel-fixture.ts";
import { kit } from "./project-fixture.ts";

export type CallOptions = {
  readonly caller?: string;
};

export type ProjectOptions = {
  readonly startAt?: string;
  readonly callers?: readonly string[];
};

type SettableClock = Clock & {
  readonly set: (time: string) => void;
};

function settableClock(startAt: string | undefined): SettableClock {
  let fixed = startAt === undefined ? undefined : Date.parse(startAt);
  return {
    now: () => (fixed === undefined ? new Date() : new Date(fixed)),
    set: (time) => {
      fixed = Date.parse(time);
    },
  };
}

export type ModeProject = {
  readonly root: string;
  readonly kernel: Kernel;
  readonly run: (reference: string, input: Json, options?: CallOptions) => Promise<Run>;
  readonly output: (reference: string, input: Json, options?: CallOptions) => Promise<Json>;
  readonly failure: (reference: string, input: Json, options?: CallOptions) => Promise<string>;
  readonly refusal: (reference: string, input: Json) => Promise<string>;
  readonly partition: (mode: string, name: string) => DatabasePartition;
  readonly setTime: (time: string) => void;
  readonly reopen: (config: Config) => Promise<ModeProject>;
  readonly close: () => Promise<void>;
};

const calledInterface = "items-store";

export function runOf(result: Outcome<Run>): Run {
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.problems, null, 2));
  return result.value;
}

function outputOf(run: Run): Json {
  if (run.state.status !== "done") {
    assert.fail(`expected the run to be done, got ${JSON.stringify(run.state)}`);
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
  const place: StepPlace = { runId: "harness", mode, action: "harness", stepKey: "harness" };
  const permissions = { grants: kernel.policyOf(mode), actionEffects: ["read" as const, "write" as const] };
  const broker = (): ReturnType<Kernel["brokerFor"]> => kernel.brokerFor(place, permissions);
  const closing = async <T>(use: (opened: ReturnType<Kernel["brokerFor"]>) => Promise<T>): Promise<T> => {
    const opened = broker();
    try {
      return await use(opened);
    } finally {
      opened.close();
    }
  };
  return {
    migrate: () => closing((opened) => opened.migrate(name)),
    execute: (sql, parameters = []) => closing((opened) => opened.execute(sql, parameters, name)),
    query: (sql, parameters = []) => closing((opened) => opened.query(sql, parameters, name)),
    agentQuery: (sql) => closing((opened) => opened.agentQuery(sql, name)),
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

export async function openModeProject(config: Config, options: ProjectOptions = {}): Promise<ModeProject> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentbay-modes-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  for (const caller of options.callers ?? []) {
    await writeCallingMode(root, caller);
  }
  return projectIn(root, { config, clock: settableClock(options.startAt) });
}

type Opening = {
  readonly config: Config;
  readonly clock: SettableClock;
};

async function projectIn(root: string, opening: Opening): Promise<ModeProject> {
  const { config, clock } = opening;
  await writeFile(join(root, "agentbay.config.yaml"), stringify(config), "utf8");
  const loaded = await loadKernel({
    layout: layoutOf({ kit, project: root }),
    ports: { ...nodeKernelPorts(testEnvironment), clock },
    environment: testEnvironment,
    platform: "linux",
  });
  assert.ok(loaded.ok, loaded.ok ? "" : JSON.stringify(loaded.problems, null, 2));
  const kernel = loaded.value;
  const started = (reference: string, input: Json, options: CallOptions = {}): Promise<Outcome<Run>> => {
    const action = options.caller === undefined ? reference : calledAs(reference, options.caller);
    return kernel.runs.start({ action }, input);
  };
  const run = async (reference: string, input: Json, options?: CallOptions): Promise<Run> =>
    runOf(await started(reference, input, options));
  return {
    root,
    kernel,
    run,
    output: async (reference, input, options) => outputOf(await run(reference, input, options)),
    failure: async (reference, input, options) => reasonOf(await run(reference, input, options)),
    refusal: async (reference, input) => {
      const result = await started(reference, input);
      assert.ok(!result.ok, `expected ${reference} to be refused, got ${JSON.stringify(result)}`);
      return result.problems.map((problem) => problem.message).join(" ");
    },
    partition: (mode, name) => partitionOf(kernel, mode, name),
    setTime: clock.set,
    reopen: async (changed) => {
      kernel.close();
      return projectIn(root, { config: changed, clock });
    },
    close: async () => {
      kernel.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
