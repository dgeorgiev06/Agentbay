import type { Dropped } from "./branch-endings.ts";

type GoAhead = "build" | "build-without-interface" | "build-over" | "build-over-without-interface";

export type StartChoices = {
  readonly offered: Readonly<Record<GoAhead, boolean>>;
  readonly withheld: Partial<Record<GoAhead, string>>;
};

type Wanted = {
  readonly interface: boolean;
  readonly over: boolean;
};

const wanted: Readonly<Record<GoAhead, Wanted>> = {
  build: { interface: true, over: false },
  "build-without-interface": { interface: false, over: false },
  "build-over": { interface: true, over: true },
  "build-over-without-interface": { interface: false, over: true },
};

const leftSaid = "An earlier run left branches of this slice; build over them or stop.";

const notLeftSaid = "No earlier run left a branch of this slice.";

const waveNotLeftSaid = "Nothing is left over from an earlier build, so there is nothing to build over.";

const namedSaid = "The slice names its interface files.";

const unnamedSaid = "The slice names no interface files.";

function reasonOf(choice: Wanted, found: Wanted): string | undefined {
  if (choice.over !== found.over) {
    return found.over ? leftSaid : notLeftSaid;
  }
  if (choice.interface !== found.interface) {
    return found.interface ? namedSaid : unnamedSaid;
  }
  return undefined;
}

export function startChoices(interfaceFiles: readonly string[], leftovers: readonly Dropped[]): StartChoices {
  const found = { interface: interfaceFiles.length > 0, over: leftovers.length > 0 };
  const reasons: Readonly<Record<GoAhead, string | undefined>> = {
    build: reasonOf(wanted.build, found),
    "build-without-interface": reasonOf(wanted["build-without-interface"], found),
    "build-over": reasonOf(wanted["build-over"], found),
    "build-over-without-interface": reasonOf(wanted["build-over-without-interface"], found),
  };
  const offered = {
    build: reasons.build === undefined,
    "build-without-interface": reasons["build-without-interface"] === undefined,
    "build-over": reasons["build-over"] === undefined,
    "build-over-without-interface": reasons["build-over-without-interface"] === undefined,
  };
  const withheld = Object.fromEntries(Object.entries(reasons).filter(([, reason]) => reason !== undefined));
  return { offered, withheld };
}

export type WaveChoices = {
  readonly offered: { readonly build: boolean; readonly "build-over": boolean };
  readonly withheld: { readonly build?: string; readonly "build-over"?: string };
};

export function waveChoices(leftovers: readonly Dropped[]): WaveChoices {
  if (leftovers.length === 0) {
    return { offered: { build: true, "build-over": false }, withheld: { "build-over": waveNotLeftSaid } };
  }
  const left = "An earlier run left branches of this wave; build over them or stop.";
  return { offered: { build: false, "build-over": true }, withheld: { build: left } };
}

export function stopReason(choice: string): string | undefined {
  return choice === "stop" ? "The owner chose stop on the start card, so nothing is cut." : undefined;
}

export function buildsOver(choice: string): boolean {
  return choice === "build-over" || choice === "build-over-without-interface";
}
