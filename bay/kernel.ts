import { createBroker, type StepBroker } from "./broker/broker.ts";
import type { FileListing } from "./check-context.ts";
import type { Layout } from "./layout.ts";
import type { Permissions, StepPlace } from "./contracts.ts";
import {
  createNodeHttp,
  createProjectFileListing,
  nodeChildProcesses,
  nodeFileInspector,
  nodeFileSystem,
  nodeFolders,
  nodeProcesses,
  nodeRemoval,
  nodeThrowawayFolders,
  systemClock,
} from "./node-ports.ts";
import type {
  ChildProcesses,
  Clock,
  FileInspector,
  FileSystem,
  Folders,
  Http,
  Processes,
  Removal,
  ThrowawayFolders,
} from "./ports.ts";
import { interfaceSchemasOf, loadSystem, type System } from "./manifests/manifests.ts";
import { openRuns, type Runs } from "./runs/runs.ts";
import { SecretStore, type SecretStoreOptions } from "./secrets.ts";
import type { Outcome } from "./outcome.ts";

export type KernelPorts = {
  readonly files: FileSystem;
  readonly throwawayFolders: ThrowawayFolders;
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
  readonly secrets: SecretStore;
  readonly runs: Runs;
  readonly brokerFor: (place: StepPlace, permissions: Permissions) => StepBroker;
  readonly close: () => void;
};

const httpLimits = { maximumResponseBytes: 10 * 1024 * 1024, timeoutMilliseconds: 60_000 };

function searchPathOf(environment: Environment): string {
  return environment.PATH ?? "/usr/bin:/bin";
}

export function nodeKernelPorts(environment: Environment): KernelPorts {
  return {
    files: nodeFileSystem,
    throwawayFolders: nodeThrowawayFolders,
    folders: nodeFolders,
    removal: nodeRemoval,
    inspector: nodeFileInspector,
    http: createNodeHttp(httpLimits),
    processes: nodeProcesses,
    childProcesses: nodeChildProcesses,
    clock: systemClock,
    listing: createProjectFileListing({ PATH: searchPathOf(environment) }, nodeFileInspector),
  };
}

function storeOptionsOf(options: Omit<KernelOptions, "layout">): SecretStoreOptions {
  return { environment: options.environment, processes: options.ports.processes, platform: options.platform };
}

export function secretStoreOf(options: Omit<KernelOptions, "layout">): SecretStore {
  return new SecretStore(storeOptionsOf(options));
}

export async function loadKernel(options: KernelOptions): Promise<Outcome<Kernel>> {
  const { ports, layout } = options;
  const loaded = await loadSystem(ports.files, layout);
  if (!loaded.ok) {
    return loaded;
  }
  const system = loaded.value;
  const declaredBy = [...system.modes.values()].map((mode) => mode.grants);
  const secrets = await SecretStore.open({ ...storeOptionsOf(options), declaredBy });
  const limits = { toolCallsPerRound: maximumToolCallsPerRound, ...options.limits };
  const services = {
    layout,
    files: ports.files,
    throwawayFolders: ports.throwawayFolders,
    inspector: ports.inspector,
    http: ports.http,
    secrets,
    interfaceSchemas: interfaceSchemasOf(system),
  };
  const processes = {
    clock: ports.clock,
    childProcesses: ports.childProcesses,
    processes: ports.processes,
    commandSearchPath: searchPathOf(options.environment),
  };
  const runs = await openRuns({
    project: layout.project,
    folders: ports.folders,
    clock: ports.clock,
    system,
    scrubber: secrets,
    toolCallsPerRound: limits.toolCallsPerRound,
    runner: (events) => createBroker({ ...services, ...processes, events }).scripts,
  });
  const brokerFor = createBroker({ ...services, ...processes, events: runs.events }).forStep;
  const kernel: Kernel = {
    limits,
    layout,
    ports,
    system,
    secrets,
    runs,
    brokerFor,
    close: runs.close,
  };
  return { ok: true, value: kernel };
}
