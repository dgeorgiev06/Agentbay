import { join } from "node:path/posix";
import { Broker } from "./broker.ts";
import type { FileListing } from "./check-context.ts";
import type { Layout } from "./layout.ts";
import type { Permissions, PolicyOf, ScriptRunner, StepPlace } from "./contracts.ts";
import { Engine } from "./runs/engine.ts";
import {
  createNodeHttp,
  createProjectFileListing,
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeFolders,
  nodeProcesses,
  nodeRemoval,
  systemClock,
} from "./node-ports.ts";
import { loadPolicedSystem } from "./policy.ts";
import type { ChildProcesses, Clock, FileInspector, FileSystem, Folders, Http, Processes, Removal } from "./ports.ts";
import type { System } from "./registry.ts";
import { kernelDatabaseFile } from "./runs/run-store.ts";
import { SqliteRunStore } from "./runs/sqlite-run-store.ts";
import { createScriptRunner } from "./script-runner.ts";
import { SecretStore } from "./secrets.ts";
import type { Outcome } from "./outcome.ts";

export type KernelPorts = {
  readonly files: FileSystem;
  readonly folders: Folders;
  readonly removal: Removal;
  readonly inspector: FileInspector;
  readonly http: Http;
  readonly processes: Processes;
  readonly childProcesses: ChildProcesses;
  readonly clock: Clock;
  readonly listing: FileListing;
};

export type Environment = Readonly<Record<string, string | undefined>>;

export type KernelLimits = {
  readonly toolCallsPerRound: number;
};

const maximumToolCallsPerRound = 200;

export type KernelOptions = {
  readonly limits?: Partial<KernelLimits>;
  readonly layout: Layout;
  readonly ports: KernelPorts;
  readonly environment: Environment;
  readonly platform: string;
};

export type Kernel = {
  readonly limits: KernelLimits;
  readonly layout: Layout;
  readonly ports: KernelPorts;
  readonly system: System;
  readonly policyOf: PolicyOf;
  readonly secrets: SecretStore;
  readonly store: SqliteRunStore;
  readonly runner: ScriptRunner;
  readonly engine: Engine;
  readonly brokerFor: (place: StepPlace, permissions: Permissions) => Broker;
  readonly close: () => void;
};

const httpLimits = { maximumResponseBytes: 10 * 1024 * 1024, timeoutMilliseconds: 60_000 };

export function nodeKernelPorts(environment: Environment): KernelPorts {
  return {
    files: nodeFileSystem,
    folders: nodeFolders,
    removal: nodeRemoval,
    inspector: nodeFileInspector,
    http: createNodeHttp(httpLimits),
    processes: nodeProcesses,
    childProcesses: nodeChildProcesses,
    clock: systemClock,
    listing: createProjectFileListing({ PATH: environment.PATH ?? "/usr/bin:/bin" }, nodeFileInspector),
  };
}

export function secretStoreOf(options: Omit<KernelOptions, "layout">): SecretStore {
  return new SecretStore({
    environment: options.environment,
    processes: options.ports.processes,
    platform: options.platform,
  });
}

export async function loadKernel(options: KernelOptions): Promise<Outcome<Kernel>> {
  const { ports, layout } = options;
  const loaded = (await loadPolicedSystem(ports.files, layout)).outcome;
  if (!loaded.ok) {
    return loaded;
  }
  const { system, policyOf } = loaded.value;
  const secrets = secretStoreOf(options);
  const store = await SqliteRunStore.open(ports.folders, join(layout.project, kernelDatabaseFile));
  const services = { layout, files: ports.files, inspector: ports.inspector, http: ports.http, secrets };
  const shared = { ...services, events: store, clock: ports.clock, childProcesses: ports.childProcesses };
  const brokerFor = (place: StepPlace, permissions: Permissions): Broker =>
    new Broker({ ...shared, place, permissions });
  const runner = createScriptRunner(shared);
  const engine = new Engine({
    system,
    store,
    runner,
    policyOf,
    clock: ports.clock,
    files: ports.files,
    scrubber: secrets,
  });
  const kernel: Kernel = {
    limits: { toolCallsPerRound: maximumToolCallsPerRound, ...options.limits },
    layout,
    ports,
    system,
    policyOf,
    secrets,
    store,
    runner,
    engine,
    brokerFor,
    close: () => {
      store.close();
    },
  };
  return { ok: true, value: kernel };
}
