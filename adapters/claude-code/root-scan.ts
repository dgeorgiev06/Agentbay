import { dirname, isAbsolute, join, normalize, relative, sep } from "node:path";
import type { GrantedFoldersRequest, SkillAgent } from "../../bay/adapter.ts";
import type { DirectoryEntry, Problem } from "./adapter-types.ts";
import { searchBound } from "./guard-input.ts";
import { closedName } from "./guard-paths.ts";

type Scan =
  { readonly kind: "clear" } | { readonly kind: "closed"; readonly path: string } | { readonly kind: "too-large" };

const worktreePointer = /^gitdir: ([^\r\n]+)\n?$/;

function isWorktreePointer(text: string | undefined, worktrees: string): boolean {
  const target = text === undefined ? undefined : worktreePointer.exec(text)?.[1];
  return target !== undefined && normalize(target) === target && dirname(target) === worktrees;
}

async function realWorktreesFolder(request: GrantedFoldersRequest): Promise<string> {
  const { project } = request.layout;
  return join((await request.inspector.realPath(project)) ?? project, ".git", "worktrees");
}

async function isClosedEntry(request: GrantedFoldersRequest, path: string, entry: DirectoryEntry): Promise<boolean> {
  if (closedName(entry.name) === undefined) {
    return false;
  }
  if (entry.name !== ".git" || entry.kind !== "file") {
    return true;
  }
  return !isWorktreePointer(await request.files.readText(path), await realWorktreesFolder(request));
}

function ownClosedSegment(folder: string, bases: readonly string[]): boolean {
  return bases.some((base) => {
    const below = relative(base, folder);
    return !below.startsWith("..") && below.split(sep).some((segment) => closedName(segment) !== undefined);
  });
}

async function scanFolder(request: GrantedFoldersRequest, folder: string): Promise<Scan> {
  const { inspector } = request;
  const queue = [{ path: folder, depth: 0 }];
  let seen = 0;
  for (const next of queue) {
    for (const entry of await inspector.entries(next.path)) {
      seen += 1;
      const path = join(next.path, entry.name);
      if (await isClosedEntry(request, path, entry)) {
        return { kind: "closed", path };
      }
      const depth = next.depth + 1;
      if (seen > searchBound.entries || (depth > searchBound.depth && (await inspector.entries(path)).length > 0)) {
        return { kind: "too-large" };
      }
      queue.push({ path, depth });
    }
  }
  return { kind: "clear" };
}

async function rootProblem(
  request: GrantedFoldersRequest,
  agent: SkillAgent,
  folder: string,
): Promise<Problem | undefined> {
  const where = { file: agent.skillFile, path: "" };
  if (ownClosedSegment(folder, [request.layout.project, request.layout.kit])) {
    return { ...where, message: `the step ${agent.agent} is granted ${folder}, whose path names a closed location` };
  }
  const scan = await scanFolder(request, folder);
  switch (scan.kind) {
    case "clear":
      return undefined;
    case "closed":
      return {
        ...where,
        message: `the step ${agent.agent} is granted ${folder}, which holds ${scan.path}`,
        fix: "grant the mode a narrower folder: a folder that holds secrets or agentbay's own files is closed to steps",
      };
    case "too-large":
      return {
        ...where,
        message:
          `the step ${agent.agent} is granted ${folder}, which holds more than ${String(searchBound.entries)} ` +
          `entries or is deeper than ${String(searchBound.depth)} levels, more than the build checks`,
        fix: "grant the mode a narrower folder",
      };
  }
}

export async function grantedRootProblems(request: GrantedFoldersRequest): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  for (const agent of request.agents) {
    const roots = new Set([...agent.grants.readPaths, ...agent.grants.writePaths]);
    for (const folder of roots) {
      const absolute = isAbsolute(folder) ? folder : join(request.layout.project, folder);
      const problem = await rootProblem(request, agent, absolute);
      if (problem !== undefined) {
        problems.push(problem);
      }
    }
  }
  return problems;
}
