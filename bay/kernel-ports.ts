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
  FileListing,
  FileSystem,
  Folders,
  Http,
  Processes,
  Removal,
  ThrowawayFolders,
} from "./ports.ts";

export type Environment = Readonly<Record<string, string | undefined>>;

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

const httpLimits = { maximumResponseBytes: 10 * 1024 * 1024, timeoutMilliseconds: 60_000 };

export function searchPathOf(environment: Environment): string {
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
