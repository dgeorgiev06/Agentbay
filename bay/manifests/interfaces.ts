import type { Interface } from "../generated/interface.ts";
import type { Mode } from "../generated/mode.ts";
import type { Wording } from "./spec.ts";
import { interfaceFolders } from "./folders.ts";
import { type Context, shown } from "./loaded.ts";

export function interfaceName(reference: string): string {
  return reference.slice(0, reference.indexOf("@"));
}

export function interfaceReference(definition: Interface): string {
  return `${definition.name}@${String(definition.version)}`;
}

export function requiredReferences(mode: Mode): readonly string[] {
  return mode.requires?.interfaces ?? [];
}

export function implementersOf(context: Context, reference: string): readonly string[] {
  return [...context.modes.values()]
    .filter((mode) => mode.value.implements?.includes(reference) === true)
    .map((mode) => mode.value.name);
}

export function unknownInterface(context: Context, subject: string, reference: string): Wording {
  const otherVersions = [...context.interfaces.keys()].filter((key) => interfaceName(key) === interfaceName(reference));
  const found = otherVersions.length === 0 ? "" : ` (found: ${otherVersions.join(", ")})`;
  const folders = interfaceFolders(context.layout).map((folder) => shown(context, folder));
  return {
    message: `${subject} ${reference}, but no interface file in ${folders.join(" or ")} defines it${found}.`,
    fix: `Correct the name or major version, or add the interface to ${folders.at(-1) ?? ""}.`,
  };
}

export function candidatesOf(context: Context, reference: string): string {
  const implementers = implementersOf(context, reference);
  return implementers.length === 0 ? "none yet" : implementers.join(", ");
}

export function requirersOf(context: Context, name: string): readonly string[] {
  return [...context.modes.values()]
    .filter((mode) => requiredReferences(mode.value).some((reference) => interfaceName(reference) === name))
    .map((mode) => mode.value.name);
}
