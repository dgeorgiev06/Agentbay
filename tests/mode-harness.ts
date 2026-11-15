import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stringify } from "yaml";
import type { Json, StepPlace } from "../bay/contracts.ts";
import type { Config } from "../bay/generated/config.ts";
import { layoutOf } from "../bay/layout.ts";
import { loadKernel, nodeKernelPorts, type Kernel } from "../bay/kernel.ts";
import type { RunView } from "../bay/runs/run-state.ts";
import type { Outcome } from "../bay/outcome.ts";
import type { Clock } from "../bay/ports.ts";
import type { DatabasePartition } from "../bay/sdk.ts";
import { testEnvironment } from "./kernel-fixture.ts";
import { kit } from "./project-fixture.ts";

export type CallOptions = {
  readonly caller?: string;
};

export type ProjectOptions = {
  readonly startAt?: string;
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
  readonly run: (reference: string, input: Json, options?: CallOptions) => Promise<RunView>;
  readonly output: (reference: string, input: Json, options?: CallOptions) => Promise<Json>;
  readonly failure: (reference: string, input: Json, options?: CallOptions) => Promise<string>;
  readonly refusal: (reference: string, input: Json) => Promise<string>;
  readonly partition: (mode: string, name: string) => DatabasePartition;
  readonly setTime: (time: string) => void;
  readonly reopen: (config: Config) => Promise<ModeProject>;
  readonly close: () => Promise<void>;
};

export function runOf(result: Outcome<RunView>): RunView {
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.problems, null, 2));
  return result.value;
}

function outputOf(run: RunView): Json {
  if (run.state.status !== "done") {
    assert.fail(`expected the run to be done, got ${JSON.stringify(run.state)}`);
  }
  return run.state.output;
}

function reasonOf(run: RunView): string {
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

export async function openModeProject(config: Config, options: ProjectOptions = {}): Promise<ModeProject> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentbay-modes-")));
  execFileSync("git", ["init", "-q"], { cwd: root });
  return projectIn(root, { config, clock: settableClock(options.startAt) }, 0);
}

type Opening = {
  readonly config: Config;
  readonly clock: SettableClock;
};

async function projectIn(root: string, opening: Opening, firstRun: number): Promise<ModeProject> {
  const { config, clock } = opening;
  await writeFile(join(root, "agentbay.config.yaml"), stringify(config), "utf8");
  const ports = nodeKernelPorts(testEnvironment);
  const loaded = await loadKernel({
    layout: layoutOf({ kit, project: root }),
    ports: { ...ports, clock },
    environment: testEnvironment,
    platform: "linux",
  });
  assert.ok(loaded.ok, loaded.ok ? "" : JSON.stringify(loaded.problems, null, 2));
  const kernel = loaded.value;
  let runs = firstRun;
  const run = async (reference: string, input: Json, options: CallOptions = {}): Promise<RunView> => {
    runs += 1;
    const id = `harness-${String(runs)}`;
    const caller = options.caller === undefined ? {} : { caller: options.caller };
    return runOf(await kernel.engine.startAction(reference, input, { id, ...caller }));
  };
  return {
    root,
    kernel,
    run,
    output: async (reference, input, options) => outputOf(await run(reference, input, options)),
    failure: async (reference, input, options) => reasonOf(await run(reference, input, options)),
    refusal: async (reference, input) => {
      const result = await kernel.engine.startAction(reference, input, { id: `refused-${String(runs)}` });
      assert.ok(!result.ok, `expected ${reference} to be refused, got ${JSON.stringify(result)}`);
      return result.problems.map((problem) => problem.message).join(" ");
    },
    partition: (mode, name) => partitionOf(kernel, mode, name),
    setTime: clock.set,
    reopen: async (changed) => {
      kernel.close();
      return projectIn(root, { config: changed, clock }, runs + 1000);
    },
    close: async () => {
      kernel.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}
