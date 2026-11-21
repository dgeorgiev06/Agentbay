import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  symlink,
  writeFile,
} from "node:fs/promises";
import { dirname } from "node:path";
import type { Readable } from "node:stream";
import { createOwnerOnlyFile } from "./owner-only.ts";
import type {
  Child,
  ChildEnd,
  ChildProcesses,
  ChildRequest,
  Clock,
  DirectoryEntry,
  EntryKind,
  FileInspector,
  FileListing,
  FileSystem,
  Folders,
  Http,
  HttpRequest,
  HttpResponse,
  ProcessEnd,
  Processes,
  ProcessOutput,
  ProcessRequest,
  ProcessResult,
  Removal,
  ThrowawayFolders,
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

async function makeFolder(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

async function link(path: string, target: string): Promise<void> {
  await symlink(target, path);
}

async function removeAll(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true });
}

export const nodeFileSystem: FileSystem = { readText, list, exists, writeAtomic };

export const nodeThrowawayFolders: ThrowawayFolders = { makeFolder, link, removeAll };

export const systemClock: Clock = { now: () => new Date() };

export const nodeFolders: Folders = {
  ensureOwnerOnlyFile: (file) => {
    createOwnerOnlyFile(file);
    return Promise.resolve();
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

const keptOutputCharacters = 1024 * 1024;

const errorOutputTail = 8 * 1024;

function collectedOutput(stream: Readable): () => ProcessOutput {
  const hash = createHash("sha256");
  let text = "";
  let characters = 0;
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => {
    hash.update(chunk, "utf8");
    characters += chunk.length;
    text = (text + chunk).slice(-keptOutputCharacters);
  });
  return () => ({ text, characters, hash: hash.digest("hex") });
}

function stopGroup(leader: number | undefined): void {
  if (leader === undefined) {
    return;
  }
  try {
    process.kill(-leader, "SIGKILL");
  } catch {
    return;
  }
}

function endOfProcess(timedOut: boolean, exitCode: number | null, signal: string | null): ProcessEnd {
  if (timedOut) {
    return { how: "timed-out" };
  }
  if (exitCode !== null) {
    return { how: "exited", exitCode };
  }
  return { how: "signalled", signal: signal ?? "unknown" };
}

function runProcess(request: ProcessRequest): Promise<ProcessResult> {
  return new Promise((resolve) => {
    const child = spawn(request.command, [...request.arguments], {
      cwd: request.directory,
      env: { ...request.environment },
      stdio: ["pipe", "pipe", "pipe"],
      shell: false,
      detached: true,
    });
    const stdout = collectedOutput(child.stdout);
    const stderr = collectedOutput(child.stderr);
    let timedOut = false;
    let settled = false;
    const timer = setTimeout(() => {
      timedOut = true;
      stopGroup(child.pid);
    }, request.timeoutMilliseconds);
    const settle = (end: ProcessEnd): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      stopGroup(child.pid);
      resolve({ end, stdout: stdout(), stderr: stderr() });
    };
    child.stdin.on("error", () => undefined);
    child.on("error", (error) => {
      settle({ how: "not-started", reason: error.message });
    });
    child.on("close", (exitCode, signal) => {
      settle(endOfProcess(timedOut, exitCode, signal));
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

const unlistedFolders: readonly string[] = ["node_modules", ".git", ".agentbay"];

async function walkedFiles(inspector: FileInspector, root: string, folder = ""): Promise<readonly string[]> {
  const found: string[] = [];
  for (const entry of await inspector.entries(folder === "" ? root : `${root}/${folder}`)) {
    const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
    if (entry.kind !== "directory") {
      found.push(path);
    } else if (!unlistedFolders.includes(entry.name)) {
      found.push(...(await walkedFiles(inspector, root, path)));
    }
  }
  return found;
}

export function createProjectFileListing(
  environment: Readonly<Record<string, string>>,
  inspector: FileInspector,
): FileListing {
  return {
    projectFiles: async (root) => {
      const result = await runProcess({
        command: "git",
        arguments: ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
        directory: root,
        environment,
        timeoutMilliseconds: listingMilliseconds,
      });
      if (result.end.how !== "exited" || result.end.exitCode !== 0) {
        return [...(await walkedFiles(inspector, root))].sort();
      }
      return [...new Set(result.stdout.text.split("\0").filter((path) => path !== ""))].sort();
    },
  };
}
