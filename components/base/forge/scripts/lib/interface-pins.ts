import { fieldsOf, shortHash, type Json } from "../../../../../bay/sdk.ts";
import { listOf, textOf } from "./json-values.ts";

export type Pinned = {
  readonly path: string;
  readonly hash?: string;
};

export type InterfaceChange = {
  readonly path: string;
  readonly how: "changed" | "appeared" | "vanished" | "not compared";
};

export type Pins = {
  readonly base: readonly Pinned[];
  readonly head: readonly Pinned[];
};

const changeWords: Readonly<Record<InterfaceChange["how"], string>> = {
  changed: "changed during the rounds",
  appeared: "appeared during the rounds",
  vanished: "is gone at the head",
  "not compared": "could not be compared with the base",
};

export function pinnedOf(path: string, text: string | undefined): Pinned {
  return text === undefined ? { path } : { path, hash: shortHash(text) };
}

function pinnedFrom(value: Json): Pinned {
  const fields = fieldsOf(value);
  const path = textOf(fields.path);
  return typeof fields.hash === "string" ? { path, hash: fields.hash } : { path };
}

export function pinsOf(value: Json | undefined): readonly Pinned[] {
  return listOf(value).map(pinnedFrom);
}

function changeOf(base: Pinned, head: Pinned | undefined): InterfaceChange | undefined {
  if (head === undefined) {
    return { path: base.path, how: "not compared" };
  }
  if (base.hash === head.hash) {
    return undefined;
  }
  if (base.hash === undefined) {
    return { path: base.path, how: "appeared" };
  }
  return { path: base.path, how: head.hash === undefined ? "vanished" : "changed" };
}

export function interfaceChanges(pins: Pins): readonly InterfaceChange[] {
  return pins.base.flatMap((base) => {
    const head = pins.head.find((pinned) => pinned.path === base.path);
    return changeOf(base, head) ?? [];
  });
}

export function interfaceWords(pins: Pins): readonly string[] {
  if (pins.base.length === 0) {
    return [];
  }
  const changes = interfaceChanges(pins);
  if (changes.length === 0) {
    return [`interface files: ${String(pins.base.length)} unchanged since the base, by hash`];
  }
  return changes.map((change) => `interface file ${changeWords[change.how]}: ${change.path}`);
}

export function interfaceClauses(changes: readonly InterfaceChange[]): readonly string[] {
  return changes.map((change) => `the interface file ${change.path} ${changeWords[change.how]}`);
}
