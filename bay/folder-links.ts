import { join } from "node:path/posix";
import { expectedRealPath } from "./file-access.ts";
import { isInsideOrEqual, type Layout } from "./layout.ts";
import type { FileInspector } from "./ports.ts";

export type EscapingLink = {
  readonly link: string;
  readonly folder: string;
  readonly target: string | undefined;
};

async function linksLeaving(inspector: FileInspector, folder: string, realFolder: string): Promise<EscapingLink[]> {
  const found: EscapingLink[] = [];
  const directories = [folder];
  for (let directory = directories.pop(); directory !== undefined; directory = directories.pop()) {
    for (const entry of await inspector.entries(directory)) {
      const path = join(directory, entry.name);
      if (entry.kind === "directory") {
        directories.push(path);
      } else if (entry.kind === "link") {
        const target = await inspector.realPath(path);
        if (target === undefined || !isInsideOrEqual(target, realFolder)) {
          found.push({ link: path, folder, target });
        }
      }
    }
  }
  return found;
}

export async function escapingLinks(
  inspector: FileInspector,
  layout: Layout,
  folders: readonly string[],
): Promise<readonly EscapingLink[]> {
  const found: EscapingLink[] = [];
  for (const folder of new Set(folders)) {
    const realFolder = await inspector.realPath(folder);
    if (realFolder === undefined) {
      continue;
    }
    if (realFolder !== (await expectedRealPath(inspector, layout, folder))) {
      found.push({ link: folder, folder, target: realFolder });
      continue;
    }
    found.push(...(await linksLeaving(inspector, folder, realFolder)));
  }
  return found;
}
