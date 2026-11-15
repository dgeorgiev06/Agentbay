import { normalize } from "node:path/posix";
import type { Clock, FileSystem, Folders } from "../bay/ports.ts";

export type FakeFileSystem = FileSystem & {
  readonly contents: ReadonlyMap<string, string>;
};

type FakeClock = Clock & {
  readonly advance: (milliseconds: number) => void;
};

function childNames(contents: ReadonlyMap<string, string>, directory: string): readonly string[] {
  const prefix = `${normalize(directory).replace(/\/$/, "")}/`;
  const names = new Set<string>();
  for (const path of contents.keys()) {
    if (path.startsWith(prefix)) {
      names.add(path.slice(prefix.length).split("/")[0] ?? "");
    }
  }
  return [...names].sort();
}

export function fakeFileSystem(initial: Readonly<Record<string, string>> = {}): FakeFileSystem {
  const contents = new Map(Object.entries(initial).map(([path, text]) => [normalize(path), text]));
  return {
    contents,
    readText: (path) => Promise.resolve(contents.get(normalize(path))),
    list: (directory) => Promise.resolve(childNames(contents, directory)),
    exists: (path) => Promise.resolve(contents.has(normalize(path)) || childNames(contents, path).length > 0),
    writeAtomic: (path, text) => {
      contents.set(normalize(path), text);
      return Promise.resolve();
    },
  };
}

export function fakeFolders(): Folders & { readonly created: readonly string[] } {
  const created: string[] = [];
  return {
    created,
    ensureFolder: (path) => {
      created.push(normalize(path));
      return Promise.resolve();
    },
  };
}

export function fakeClock(start: Date): FakeClock {
  let current = start.getTime();
  return {
    now: () => new Date(current),
    advance: (milliseconds) => {
      current += milliseconds;
    },
  };
}
