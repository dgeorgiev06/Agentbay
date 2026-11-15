import { isAbsolute, join, normalize, relative } from "node:path/posix";
import type { Problem } from "./outcome.ts";

export type Home = "kit" | "project";

export type Layout = {
  readonly kit: string;
  readonly project: string;
  readonly configFile: string;
};

const configFileName = "agentbay.config.yaml";

const kitPrefix = "kit:";

export function layoutOf(folders: { readonly kit: string; readonly project: string }): Layout {
  const kit = normalized(folders.kit);
  const project = normalized(folders.project);
  return { kit, project, configFile: join(project, configFileName) };
}

function normalized(folder: string): string {
  const path = normalize(folder);
  return path.length > 1 ? path.replace(/\/+$/, "") : path;
}

export function isProjectTheKit(layout: Layout): boolean {
  return layout.kit === layout.project;
}

export function homeFolder(layout: Layout, home: Home): string {
  return home === "kit" ? layout.kit : layout.project;
}

export function pathIn(layout: Layout, home: Home, path: string): string {
  return join(homeFolder(layout, home), path);
}

export function isInsideOrEqual(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
}

export function homeOf(layout: Layout, path: string): Home | undefined {
  const inProject = isInsideOrEqual(path, layout.project);
  const inKit = isInsideOrEqual(path, layout.kit);
  if (inProject && inKit) {
    return layout.project.length >= layout.kit.length ? "project" : "kit";
  }
  if (inProject) {
    return "project";
  }
  return inKit ? "kit" : undefined;
}

export function shownPath(layout: Layout, path: string): string {
  if (!isAbsolute(path)) {
    return path;
  }
  const home = homeOf(layout, path);
  if (home === undefined) {
    return path;
  }
  const below = relative(homeFolder(layout, home), path) || ".";
  return home === "kit" && !isProjectTheKit(layout) ? `${kitPrefix}${below}` : below;
}

export function shownProblems(layout: Layout, problems: readonly Problem[]): readonly Problem[] {
  return problems.map((problem) => ({ ...problem, file: shownPath(layout, problem.file) }));
}
