import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { access, lstat, mkdir, readdir, readFile, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FileListing } from "./check.ts";
import type {
  Child,
  ChildEnd,
  ChildProcesses,
  ChildRequest,
  Clock,
  DirectoryEntry,
  EntryKind,
  FileInspector,
  FileSystem,
  Folders,
  Http,
  HttpRequest,
  HttpResponse,
  Processes,
  ProcessRequest,
  ProcessResult,
  Removal,
} from "./ports.ts";

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
}

function isFolderNotEmpty(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOTEMPTY";
}

function isUnresolvable(error: unknown): boolean {
  return isMissingFile(error) || (error instanceof Error && "code" in error && error.code === "ELOOP");
}

async function readText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

async function list(directory: string): Promise<readonly string[]> {
  try {
    const names = await readdir(directory);
    return names.sort();
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissingFile(error)) {
      return false;
    }
    throw error;
  }
}

async function writeAtomic(path: string, text: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, text, "utf8");
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

export const nodeFileSystem: FileSystem = { readText, list, exists, writeAtomic };

export const systemClock: Clock = { now: () => new Date() };

export const nodeFolders: Folders = {
  ensureFolder: async (path) => {
    await mkdir(path, { recursive: true });
  },
};

async function removeFileOrEmptyFolder(path: string): Promise<void> {
  try {
    const entry = await lstat(path);
    await (entry.isDirectory() ? rmdir(path) : rm(path));
  } catch (error) {
    if (!isMissingFile(error) && !isFolderNotEmpty(error)) {
      throw error;
    }
  }
}

export const nodeRemoval: Removal = { remove: removeFileOrEmptyFolder };

async function realPath(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch (error) {
    if (isUnresolvable(error)) {
      return undefined;
    }
    throw error;
  }
}

async function isLink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch (error) {
    if (isMissingFile(error)) {
      return false;
    }
    throw error;
  }
}

function kindOf(entry: Dirent): EntryKind {
  if (entry.isSymbolicLink()) {
    return "link";
  }
  if (entry.isDirectory()) {
    return "directory";
  }
  return entry.isFile() ? "file" : "other";
}

async function entries(directory: string): Promise<readonly DirectoryEntry[]> {
  try {
    const found = await readdir(directory, { withFileTypes: true });
    return found
      .map((entry) => ({ name: entry.name, kind: kindOf(entry) }))
      .sort((first, second) => (first.name < second.name ? -1 : 1));
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
}

export const nodeFileInspector: FileInspector = { realPath, isLink, entries };

const processOutputBytes = 1024 * 1024;

const errorOutputTail = 8 * 1024;

function runProcess(request: ProcessRequest): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(request.command, [...request.arguments], {
      cwd: request.directory,
      env: { ...request.environment },
      stdio: ["pipe", "pipe", "pipe"],
      timeout: request.timeoutMilliseconds,
      killSignal: "SIGKILL",
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = (stdout + chunk).slice(0, processOutputBytes);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(0, processOutputBytes);
    });
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => {
      resolve({ exitCode: undefined, stdout, stderr: error.message });
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode: exitCode ?? undefined, stdout, stderr });
    });
    child.stdin.end(request.input ?? "");
  });
}

export const nodeProcesses: Processes = { run: runProcess };

type ChildState = {
  outputBytes: number;
  errorOutput: string;
  pending: string;
  stop: "timed-out" | "output-exceeded" | undefined;
};

function endOf(state: ChildState, exitCode: number | null, signal: string | null): ChildEnd {
  const errorOutput = state.errorOutput;
  if (state.stop !== undefined) {
    return { how: state.stop, errorOutput };
  }
  if (exitCode !== null) {
    return { how: "exited", exitCode, errorOutput };
  }
  return { how: "signalled", signal: signal ?? "unknown", errorOutput };
}

function startChild(request: ChildRequest, onLine: (line: string) => void): Child {
  const child = spawn(request.command, [...request.arguments], {
    cwd: request.directory,
    env: { ...request.environment },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const state: ChildState = { outputBytes: 0, errorOutput: "", pending: "", stop: undefined };
  const stopWith = (reason: "timed-out" | "output-exceeded"): void => {
    state.stop ??= reason;
    child.kill("SIGKILL");
  };
  const counted = (chunk: string): boolean => {
    state.outputBytes += Buffer.byteLength(chunk);
    if (state.outputBytes > request.maximumOutputBytes) {
      stopWith("output-exceeded");
    }
    return state.stop === undefined;
  };
  const timer = setTimeout(() => {
    stopWith("timed-out");
  }, request.timeoutMilliseconds);
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    if (!counted(chunk)) {
      return;
    }
    const lines = (state.pending + chunk).split("\n");
    state.pending = lines.pop() ?? "";
    for (const line of lines) {
      onLine(line);
    }
  });
  child.stderr.on("data", (chunk: string) => {
    if (counted(chunk)) {
      state.errorOutput = (state.errorOutput + chunk).slice(-errorOutputTail);
    }
  });
  child.stdin.on("error", () => undefined);
  const ended = new Promise<ChildEnd>((resolve) => {
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ how: "not-started", errorOutput: error.message });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      if (state.pending !== "" && state.stop === undefined) {
        onLine(state.pending);
      }
      resolve(endOf(state, exitCode, signal));
    });
  });
  return {
    send: (line) => {
      if (child.stdin.writable) {
        child.stdin.write(`${line}\n`);
      }
    },
    kill: () => {
      child.kill("SIGKILL");
    },
    ended,
  };
}

export const nodeChildProcesses: ChildProcesses = { start: startChild };

export type NodeHttpOptions = {
  readonly maximumResponseBytes: number;
  readonly timeoutMilliseconds: number;
};

async function cappedBody(response: Response, maximumBytes: number): Promise<string> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (response.body === null) {
    return "";
  }
  const reader = response.body.getReader();
  for (;;) {
    const read = await reader.read();
    if (read.done) {
      break;
    }
    const chunk: unknown = read.value;
    if (!(chunk instanceof Uint8Array)) {
      throw new Error("The response body gave something other than bytes.");
    }
    total += chunk.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new Error(`The response is more than ${String(maximumBytes)} bytes.`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export function createNodeHttp(options: NodeHttpOptions): Http {
  return {
    request: async (request: HttpRequest): Promise<HttpResponse> => {
      const response = await fetch(request.url, {
        method: request.method,
        headers: { ...request.headers },
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: "manual",
        signal: AbortSignal.timeout(options.timeoutMilliseconds),
      });
      const body = await cappedBody(response, options.maximumResponseBytes);
      return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
    },
  };
}

const listingMilliseconds = 30_000;

export function createGitFileListing(environment: Readonly<Record<string, string>>): FileListing {
  return {
    projectFiles: async (root) => {
      const result = await runProcess({
        command: "git",
        arguments: ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        directory: root,
        environment,
        timeoutMilliseconds: listingMilliseconds,
      });
      if (result.exitCode !== 0) {
        throw new Error(`git ls-files could not list the files of ${root}: ${result.stderr.trim()}`);
      }
      return [...new Set(result.stdout.split("\0").filter((path) => path !== ""))].sort();
    },
  };
}
