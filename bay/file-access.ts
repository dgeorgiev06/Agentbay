import { basename, dirname, join, relative, resolve } from "node:path/posix";
import { homeFolder, homeOf, isInsideOrEqual, type Layout } from "./layout.ts";
import type { FileInspector } from "./ports.ts";

export type Purpose = "read" | "write";

export type PathRequest = {
  readonly layout: Layout;
  readonly path: string;
  readonly permitted: readonly string[];
  readonly purpose: Purpose;
};

export type PathCheck =
  | { readonly status: "allowed"; readonly path: string }
  | { readonly status: "outside"; readonly path: string }
  | { readonly status: "through-link"; readonly path: string; readonly realPath: string }
  | { readonly status: "linked-component"; readonly path: string; readonly link: string };

async function realPathOfDeepestAncestor(inspector: FileInspector, path: string): Promise<string> {
  const missing: string[] = [];
  let current = path;
  for (;;) {
    const real = await inspector.realPath(current);
    if (real !== undefined) {
      return join(real, ...missing.reverse());
    }
    const parent = dirname(current);
    if (parent === current) {
      return path;
    }
    missing.push(basename(current));
    current = parent;
  }
}

function homeFolderOf(layout: Layout, path: string): string {
  const home = homeOf(layout, path);
  return home === undefined ? "/" : homeFolder(layout, home);
}

async function firstLinkedComponent(
  inspector: FileInspector,
  layout: Layout,
  path: string,
): Promise<string | undefined> {
  const home = homeFolderOf(layout, path);
  const segments = relative(home, path).split("/");
  for (let count = 1; count <= segments.length; count += 1) {
    const component = join(home, ...segments.slice(0, count));
    if (await inspector.isLink(component)) {
      return component;
    }
  }
  return undefined;
}

export async function expectedRealPath(inspector: FileInspector, layout: Layout, path: string): Promise<string> {
  const home = homeFolderOf(layout, path);
  return join(await realPathOfDeepestAncestor(inspector, home), relative(home, path));
}

async function realInsideAny(
  inspector: FileInspector,
  request: PathRequest,
  found: { readonly real: string; readonly folders: readonly string[] },
): Promise<boolean> {
  for (const folder of found.folders) {
    if (isInsideOrEqual(found.real, await expectedRealPath(inspector, request.layout, folder))) {
      return true;
    }
  }
  return false;
}

export async function checkPath(inspector: FileInspector, request: PathRequest): Promise<PathCheck> {
  const path = resolve(request.layout.project, request.path);
  const folders = request.permitted.filter((folder) => isInsideOrEqual(path, folder));
  if (folders.length === 0) {
    return { status: "outside", path };
  }
  const real = await realPathOfDeepestAncestor(inspector, path);
  if (!(await realInsideAny(inspector, request, { real, folders }))) {
    return { status: "through-link", path, realPath: real };
  }
  if (request.purpose === "write") {
    const link = await firstLinkedComponent(inspector, request.layout, path);
    if (link !== undefined) {
      return { status: "linked-component", path, link };
    }
  }
  return { status: "allowed", path };
}
