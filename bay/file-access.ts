import { basename, dirname, join, relative, resolve } from "node:path/posix";
import type { FileInspector } from "./broker-ports.ts";

export type Purpose = "read" | "write";

export type PathRequest = {
  readonly root: string;
  readonly path: string;
  readonly permitted: readonly string[];
  readonly purpose: Purpose;
};

export type PathCheck =
  | { readonly status: "allowed"; readonly path: string }
  | { readonly status: "outside"; readonly path: string }
  | { readonly status: "through-link"; readonly path: string; readonly realPath: string }
  | { readonly status: "linked-component"; readonly path: string; readonly link: string };

export function isInsideOrEqual(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith("/") ? folder : `${folder}/`);
}

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

async function firstLinkedComponent(inspector: FileInspector, root: string, path: string): Promise<string | undefined> {
  const segments = relative(root, path).split("/");
  for (let count = 1; count <= segments.length; count += 1) {
    const component = join(root, ...segments.slice(0, count));
    if (await inspector.isLink(component)) {
      return component;
    }
  }
  return undefined;
}

function realInsideAny(
  real: string,
  folders: readonly string[],
  roots: { readonly root: string; readonly realRoot: string },
): boolean {
  return folders.some((folder) => isInsideOrEqual(real, join(roots.realRoot, relative(roots.root, folder))));
}

export async function checkPath(inspector: FileInspector, request: PathRequest): Promise<PathCheck> {
  const path = resolve(request.root, request.path);
  const lexical = request.permitted.filter((folder) => isInsideOrEqual(path, folder));
  if (lexical.length === 0) {
    return { status: "outside", path };
  }
  const real = await realPathOfDeepestAncestor(inspector, path);
  const realRoot = await realPathOfDeepestAncestor(inspector, request.root);
  if (!isInsideOrEqual(real, realRoot) || !realInsideAny(real, lexical, { root: request.root, realRoot })) {
    return { status: "through-link", path, realPath: real };
  }
  if (request.purpose === "write") {
    const link = await firstLinkedComponent(inspector, request.root, path);
    if (link !== undefined) {
      return { status: "linked-component", path, link };
    }
  }
  return { status: "allowed", path };
}
