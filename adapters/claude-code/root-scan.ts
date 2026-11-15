import { isAbsolute, join, relative, sep } from "node:path";
import type { BuildRequest, SkillAgent } from "../../bay/adapter.ts";
import type { Files, Problem } from "./adapter-types.ts";
import { searchBound } from "./guard-input.ts";
import { closedName } from "./guard-paths.ts";

type Scan =
  { readonly kind: "clear" } | { readonly kind: "closed"; readonly path: string } | { readonly kind: "too-large" };

function ownClosedSegment(folder: string, bases: readonly string[]): boolean {
  return bases.some((base) => {
    const below = relative(base, folder);
    return !below.startsWith("..") && below.split(sep).some((segment) => closedName(segment) !== undefined);
  });
}

async function scanFolder(files: Files, folder: string): Promise<Scan> {
  const queue = [{ path: folder, depth: 0 }];
  let seen = 0;
  for (const next of queue) {
    for (const name of await files.list(next.path)) {
      seen += 1;
      const path = join(next.path, name);
      if (closedName(name) !== undefined) {
        return { kind: "closed", path };
      }
      const depth = next.depth + 1;
      if (seen > searchBound.entries || (depth > searchBound.depth && (await files.list(path)).length > 0)) {
        return { kind: "too-large" };
      }
      queue.push({ path, depth });
    }
  }
  return { kind: "clear" };
}

async function rootProblem(request: BuildRequest, agent: SkillAgent, folder: string): Promise<Problem | undefined> {
  const where = { file: agent.skillFile, path: "" };
  if (ownClosedSegment(folder, [request.root, request.kit])) {
    return { ...where, message: `the step ${agent.agent} is granted ${folder}, whose path names a closed location` };
  }
  const scan = await scanFolder(request.files, folder);
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

export async function grantedRootProblems(request: BuildRequest): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  for (const agent of request.agents) {
    const roots = new Set([...agent.permissions.readPaths, ...agent.permissions.writePaths]);
    for (const folder of roots) {
      const problem = await rootProblem(request, agent, isAbsolute(folder) ? folder : join(request.root, folder));
      if (problem !== undefined) {
        problems.push(problem);
      }
    }
  }
  return problems;
}
