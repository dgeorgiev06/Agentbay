import { isAbsolute, join } from "node:path";
import { agentName, type BuildRequest, type SkillAgent } from "../../bay/adapter.ts";
import type { ListOutcome, Problem } from "./adapter-types.ts";
import { agentFileText } from "./agent-file.ts";
import {
  readRecord,
  recordPath,
  recordText,
  sha256,
  unreadableRecord,
  type BuildRecord,
  type CreatedFile,
} from "./build-record.ts";
import { mergeTargets, planMerge, type MergePlan } from "./merged-files.ts";
import { grantedRootProblems } from "./root-scan.ts";
import { stepsFileText } from "./steps-file.ts";

type CreatedChange = "created" | "updated" | "unchanged" | "overwritten";

type CreatedPlan = { readonly path: string; readonly text: string; readonly change: CreatedChange };

type StalePlan = { readonly path: string; readonly remove: boolean };

const changeWords: Readonly<Record<CreatedChange | MergePlan["change"], string>> = {
  created: "created",
  updated: "updated",
  unchanged: "unchanged",
  overwritten: "overwritten; it was edited by hand since the last build",
  merged: "merged",
};

const staleDeleted = "deleted; no step needs it now";

const staleKept = "no longer built, but edited by hand since the last build, so left in place";

function problem(file: string, message: string, fix?: string): Problem {
  return fix === undefined ? { file, path: "", message } : { file, path: "", message, fix };
}

function folderProblems(request: BuildRequest): readonly Problem[] {
  return [request.root, request.kit].flatMap((folder) => {
    if (!isAbsolute(folder)) {
      return [problem(folder, "the project and kit folders must be absolute paths")];
    }
    return folder.includes("'") ? [problem(folder, "a folder whose path holds ' cannot be quoted in the hook")] : [];
  });
}

function agentProblems(agent: SkillAgent, seen: ReadonlySet<string>): readonly Problem[] {
  const problems: Problem[] = [];
  if (agent.agent !== agentName(agent.mode, agent.skill) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(agent.agent)) {
    problems.push(
      problem(agent.skillFile, `the agent name ${agent.agent} is not agentName(mode, skill) in plain words`),
    );
  }
  if (seen.has(agent.agent)) {
    problems.push(problem(agent.skillFile, `two skill steps share the agent name ${agent.agent}`));
  }
  for (const tool of agent.kernelTools.filter((name) => !/^[a-z][a-z0-9_]*$/.test(name))) {
    problems.push(problem(agent.skillFile, `the kernel tool name ${JSON.stringify(tool)} is not a plain tool name`));
  }
  return problems;
}

function requestProblems(request: BuildRequest): readonly Problem[] {
  const seen = new Set<string>();
  const problems = [...folderProblems(request)];
  for (const agent of request.agents) {
    problems.push(...agentProblems(agent, seen));
    seen.add(agent.agent);
  }
  return problems;
}

function createdFiles(request: BuildRequest): readonly { readonly path: string; readonly text: string }[] {
  return [
    ...request.agents.map((agent) => ({
      path: `.claude/agents/${agent.agent}.md`,
      text: agentFileText(agent, request.root),
    })),
    { path: ".agentbay/steps.json", text: stepsFileText(request.root, request.kit, request.agents) },
  ];
}

function createdChange(current: string | undefined, text: string, recorded?: CreatedFile): CreatedChange | "foreign" {
  if (current === undefined) {
    return "created";
  }
  if (recorded === undefined) {
    return current === text ? "unchanged" : "foreign";
  }
  if (sha256(current) !== recorded.sha256) {
    return "overwritten";
  }
  return current === text ? "unchanged" : "updated";
}

type Plans = {
  readonly created: readonly CreatedPlan[];
  readonly merged: readonly MergePlan[];
  readonly stale: readonly StalePlan[];
  readonly problems: readonly Problem[];
};

async function planCreated(request: BuildRequest, previous: BuildRecord | undefined): Promise<Plans> {
  const created: CreatedPlan[] = [];
  const problems: Problem[] = [];
  for (const file of createdFiles(request)) {
    const recorded = previous?.created.find((entry) => entry.path === file.path);
    const change = createdChange(await request.files.readText(join(request.root, file.path)), file.text, recorded);
    if (change === "foreign") {
      problems.push(problem(file.path, "the file exists and agentbay did not write it", "move it away, then build"));
    } else {
      created.push({ ...file, change });
    }
  }
  return { created, merged: [], stale: [], problems };
}

async function planMerged(request: BuildRequest, previous: BuildRecord | undefined): Promise<Plans> {
  const merged: MergePlan[] = [];
  const problems: Problem[] = [];
  for (const target of mergeTargets(request)) {
    const recorded = previous?.merged.find((entry) => entry.path === target.path);
    const plan = planMerge(target, await request.files.readText(join(request.root, target.path)), recorded);
    if (typeof plan === "string") {
      problems.push(problem(target.path, plan));
    } else {
      merged.push(plan);
    }
  }
  return { created: [], merged, stale: [], problems };
}

async function planStale(request: BuildRequest, previous: BuildRecord | undefined): Promise<Plans> {
  const built = new Set(createdFiles(request).map((file) => file.path));
  const stale: StalePlan[] = [];
  for (const entry of previous?.created.filter((file) => !built.has(file.path)) ?? []) {
    const current = await request.files.readText(join(request.root, entry.path));
    if (current !== undefined) {
      stale.push({ path: entry.path, remove: sha256(current) === entry.sha256 });
    }
  }
  return { created: [], merged: [], stale, problems: [] };
}

async function plansFor(request: BuildRequest, previous: BuildRecord | undefined): Promise<Plans> {
  const parts = [
    await planCreated(request, previous),
    await planMerged(request, previous),
    await planStale(request, previous),
  ];
  return {
    created: parts.flatMap((part) => part.created),
    merged: parts.flatMap((part) => part.merged),
    stale: parts.flatMap((part) => part.stale),
    problems: parts.flatMap((part) => part.problems),
  };
}

function foldersAbove(path: string): readonly string[] {
  const segments = path.split("/").slice(0, -1);
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

async function foldersToCreate(
  request: BuildRequest,
  plans: Plans,
  previous?: BuildRecord,
): Promise<readonly string[]> {
  const paths = [recordPath, ...plans.created.map((file) => file.path), ...plans.merged.map((file) => file.path)];
  const folders = new Set(previous?.createdFolders ?? []);
  for (const folder of new Set(paths.flatMap(foldersAbove))) {
    if (!(await request.files.exists(join(request.root, folder)))) {
      folders.add(folder);
    }
  }
  return [...folders].sort(
    (left, right) => right.split("/").length - left.split("/").length || left.localeCompare(right),
  );
}

async function carryOut(request: BuildRequest, plans: Plans, previous?: BuildRecord): Promise<readonly string[]> {
  const { files, root } = request;
  const record: BuildRecord = {
    version: 1,
    adapter: "claude-code",
    created: plans.created.map((file) => ({ path: file.path, sha256: sha256(file.text) })),
    merged: plans.merged.map((file) => file.entry),
    createdFolders: await foldersToCreate(request, plans, previous),
  };
  await files.writeAtomic(join(root, recordPath), recordText(record));
  const report = [`${recordPath}: written`];
  for (const file of [...plans.created, ...plans.merged].filter((plan) => plan.change !== "unchanged")) {
    await files.writeAtomic(join(root, file.path), file.text);
  }
  report.push(...[...plans.created, ...plans.merged].map((file) => `${file.path}: ${changeWords[file.change]}`));
  for (const file of plans.stale) {
    if (file.remove) {
      await request.removal.remove(join(root, file.path));
    }
    report.push(`${file.path}: ${file.remove ? staleDeleted : staleKept}`);
  }
  return report;
}

export async function build(request: BuildRequest): Promise<ListOutcome> {
  const requestIssues = requestProblems(request);
  if (requestIssues.length > 0) {
    return { ok: false, problems: requestIssues };
  }
  const rootIssues = await grantedRootProblems(request);
  if (rootIssues.length > 0) {
    return { ok: false, problems: rootIssues };
  }
  const reading = readRecord(await request.files.readText(join(request.root, recordPath)));
  if (reading.kind === "unreadable") {
    return { ok: false, problems: [unreadableRecord] };
  }
  const previous = reading.kind === "record" ? reading.record : undefined;
  const plans = await plansFor(request, previous);
  if (plans.problems.length > 0) {
    return { ok: false, problems: plans.problems };
  }
  return { ok: true, value: await carryOut(request, plans, previous) };
}
