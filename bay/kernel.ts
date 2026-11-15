import { join } from "node:path/posix";
import type { Answer } from "./answers.ts";
import { Broker } from "./broker.ts";
import type { FileListing } from "./check.ts";
import type { Permissions, PolicyOf, ScriptRunner, StepPlace } from "./contracts.ts";
import { Engine } from "./engine.ts";
import {
  createGitFileListing,
  createNodeHttp,
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeFolders,
  nodeProcesses,
  nodeRemoval,
  systemClock,
} from "./node-ports.ts";
import { policyFor } from "./policy.ts";
import type { ChildProcesses, Clock, FileInspector, FileSystem, Folders, Http, Processes, Removal } from "./ports.ts";
import { loadSystem, type System, type SystemLayout } from "./registry.ts";
import { kernelDatabaseFile, SqliteRunStore } from "./run-store.ts";
import { createScriptRunner } from "./script-runner.ts";
import { SecretStore } from "./secrets.ts";
import type { Outcome } from "./spec.ts";

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

export type KernelOptions = {
  readonly project: string;
  readonly kit: string;
  readonly ports: KernelPorts;
  readonly environment: Environment;
  readonly platform: string;
};

export type Kernel = {
  readonly root: string;
  readonly kit: string;
  readonly layout: SystemLayout;
  readonly ports: KernelPorts;
  readonly system: System;
  readonly policyOf: PolicyOf;
  readonly secrets: SecretStore;
  readonly store: SqliteRunStore;
  readonly runner: ScriptRunner;
  readonly engine: Engine;
  readonly brokerFor: (place: StepPlace, permissions: Permissions) => Broker;
  readonly prepareDatabase: (place: StepPlace, permissions: Permissions) => Promise<Answer<readonly string[]>>;
  readonly close: () => void;
};

export const configFile = "agentbay.config.yaml";

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
    listing: createGitFileListing({ PATH: environment.PATH ?? "/usr/bin:/bin" }),
  };
}

export function secretStoreOf(options: Omit<KernelOptions, "project" | "kit">): SecretStore {
  return new SecretStore({
    environment: options.environment,
    processes: options.ports.processes,
    platform: options.platform,
  });
}

function databasePreparer(
  brokerFor: Kernel["brokerFor"],
): (place: StepPlace, permissions: Permissions) => Promise<Answer<readonly string[]>> {
  const prepared = new Map<string, Promise<Answer<readonly string[]>>>();
  return (place, permissions) => {
    const earlier = prepared.get(permissions.mode);
    if (earlier !== undefined) {
      return earlier;
    }
    const broker = brokerFor(place, permissions);
    const migrated = broker.migrate().finally(() => {
      broker.close();
    });
    prepared.set(permissions.mode, migrated);
    return migrated;
  };
}

function migratingRunner(runner: ScriptRunner, prepare: Kernel["prepareDatabase"]): ScriptRunner {
  return {
    run: async (request) => {
      const migrated = await prepare(request.place, request.permissions);
      if (!migrated.ok) {
        const reason = `The database of mode ${request.permissions.mode} could not be migrated: ${migrated.message}`;
        return { status: "failed", reason, spent: { items: 0, usd: 0, tokens: 0, minutes: 0 } };
      }
      return runner.run(request);
    },
  };
}

export async function loadKernel(options: KernelOptions): Promise<Outcome<Kernel>> {
  const { ports, project: root } = options;
  const layout: SystemLayout = { root, configFile };
  const loaded = await loadSystem(ports.files, layout);
  if (!loaded.ok) {
    return loaded;
  }
  const system = loaded.value;
  const policy = policyFor(system, layout);
  if (!policy.ok) {
    return policy;
  }
  const secrets = secretStoreOf(options);
  const store = await SqliteRunStore.open(ports.folders, join(root, kernelDatabaseFile));
  const services = { root, files: ports.files, inspector: ports.inspector, http: ports.http, secrets };
  const shared = { ...services, events: store, clock: ports.clock, childProcesses: ports.childProcesses };
  const brokerFor = (place: StepPlace, permissions: Permissions): Broker =>
    new Broker({ ...shared, place, permissions });
  const prepareDatabase = databasePreparer(brokerFor);
  const runner = migratingRunner(createScriptRunner(shared), prepareDatabase);
  const engine = new Engine({
    system,
    store,
    runner,
    policyOf: policy.value,
    clock: ports.clock,
    files: ports.files,
    root,
    scrubber: secrets,
  });
  const kernel: Kernel = {
    root,
    kit: options.kit,
    layout,
    ports,
    system,
    policyOf: policy.value,
    secrets,
    store,
    runner,
    engine,
    brokerFor,
    prepareDatabase,
    close: () => {
      store.close();
    },
  };
  return { ok: true, value: kernel };
}
