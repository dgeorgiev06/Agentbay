import { basename } from "node:path/posix";
import type { Interface } from "../generated/interface.ts";
import { shownPath, type Layout } from "../layout.ts";
import { problemAt, type Loaded, type Wording } from "../value-check.ts";
import type { Problem } from "../outcome.ts";
import { manifestFileOf } from "./folders.ts";
import { type ModeSource, type LoadedModes, type Context, shown, activeModesOf } from "./loaded.ts";
import { interfaceReference } from "./interfaces.ts";

type Indexed<T> = {
  readonly index: ReadonlyMap<string, T>;
  readonly problems: readonly Problem[];
};

export function folderNameProblems(context: Context): readonly Problem[] {
  return activeModesOf(context).flatMap((mode) => {
    const folderName = basename(mode.folder);
    if (folderName === mode.value.name) {
      return [];
    }
    return [
      problemAt(mode, ["name"], {
        message: `The mode is named ${mode.value.name}, but its folder is ${shown(context, mode.folder)}.`,
        fix: `Rename the folder to ${mode.value.name}, or set name: ${folderName}.`,
      }),
    ];
  });
}

function duplicateWording(layout: Layout, name: string, files: readonly string[]): Wording {
  const both = files.map((file) => shownPath(layout, file)).join(" and ");
  return {
    message: `Two modes are named ${name}: ${both}.`,
    fix: "Rename one of them; every mode needs its own name, and a project mode cannot replace a kit mode.",
  };
}

export function indexModes(modes: LoadedModes, layout: Layout): Indexed<ModeSource> {
  const index = new Map<string, ModeSource>();
  const seen = new Map<string, string>();
  const problems: Problem[] = [];
  for (const mode of modes.unloaded) {
    const first = seen.get(mode.name);
    const file = manifestFileOf(mode);
    if (first !== undefined) {
      problems.push({ file, path: "", ...duplicateWording(layout, mode.name, [first, file]) });
    }
    seen.set(mode.name, first ?? file);
  }
  for (const mode of modes.values) {
    const name = mode.value.name;
    const first = seen.get(name);
    if (first !== undefined) {
      problems.push(problemAt(mode, ["name"], duplicateWording(layout, name, [first, mode.file])));
      continue;
    }
    seen.set(name, mode.file);
    index.set(name, mode);
  }
  return { index, problems };
}

export function indexInterfaces(interfaces: readonly Loaded<Interface>[], layout: Layout): Indexed<Loaded<Interface>> {
  const index = new Map<string, Loaded<Interface>>();
  const problems: Problem[] = [];
  for (const loaded of interfaces) {
    const reference = interfaceReference(loaded.value);
    const first = index.get(reference);
    if (first === undefined) {
      index.set(reference, loaded);
      continue;
    }
    problems.push(
      problemAt(loaded, ["name"], {
        message: `Two interface files define ${reference}: ${shownPath(layout, first.file)} and ${shownPath(layout, loaded.file)}.`,
        fix: "Remove one of them, or give one a different name or version.",
      }),
    );
  }
  return { index, problems };
}
