import assert from "node:assert/strict";
import { Engine, type AdvancedRun } from "../../../bay/runs/engine.ts";
import type { System } from "../../../bay/registry.ts";
import type { RunStore } from "../../../bay/runs/run-store.ts";
import { SqliteRunStore } from "../../../bay/runs/sqlite-run-store.ts";
import type { Waiting } from "../../../bay/runs/run-state.ts";
import type { Outcome } from "../../../bay/outcome.ts";
import type { SecretStore } from "../../../bay/secrets.ts";
import { fakeClock } from "../../fakes.ts";
import {
  fakeRunner,
  fixtureScrubber,
  fixtureSystem,
  policyOfSystem,
  startTime,
  type Changes,
  type FakeRunner,
  type FixtureSystem,
  type Script,
} from "../../runs-fixture.ts";
import { temporaryKernelDb, type KernelDb } from "./kernel-db-fixture.ts";

type FreshEngine = {
  readonly system?: System;
  readonly store?: RunStore;
  readonly owner?: string;
  readonly runId?: string;
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
      newId: () => fresh.runId ?? `run-${String(engines)}`,
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

export function runOf<T>(result: Outcome<T>): T {
  assert.ok(result.ok, result.ok ? "" : JSON.stringify(result.problems, null, 2));
  return result.value;
}

export function waitingOf(result: Outcome<AdvancedRun>): Waiting {
  const run = runOf(result);
  assert.equal(run.state.status, "waiting", JSON.stringify(run.state));
  return run.state.waiting;
}

export function problemsOf(result: Outcome<unknown>): readonly string[] {
  assert.ok(!result.ok, `expected a refusal, got ${JSON.stringify(result)}`);
  return result.problems.map((problem) => problem.message);
}

export async function eventKinds(store: RunStore, runId: string): Promise<readonly string[]> {
  return (await store.readEvents(runId)).map((event) => event.kind);
}
