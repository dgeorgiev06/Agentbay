import type { Config } from "../generated/config.ts";
import type { PathSegments } from "./spec.ts";
import type { Context } from "./loaded.ts";
import { interfaceName, requiredReferences } from "./interfaces.ts";

export type RequiredBinding = {
  readonly reference: string;
  readonly bound: BoundMode;
};

type BoundMode = {
  readonly mode: string;
  readonly path: PathSegments;
  readonly label: string;
};

export const defaultKey = "default";

export function bindingFor(bindings: Config["bindings"], requirer: string, reference: string): BoundMode | undefined {
  const name = interfaceName(reference);
  const binding = Object.hasOwn(bindings, name) ? bindings[name] : undefined;
  if (binding === undefined) {
    return undefined;
  }
  if (typeof binding === "string") {
    return { mode: binding, path: ["bindings", name], label: name };
  }
  const key = Object.hasOwn(binding, requirer) ? requirer : defaultKey;
  const mode = Object.hasOwn(binding, key) ? binding[key] : undefined;
  return mode === undefined ? undefined : { mode, path: ["bindings", name, key], label: `${name} for ${requirer}` };
}

export function boundModeOf(context: Context, requirer: string, reference: string): BoundMode | undefined {
  const config = context.config;
  return config === undefined ? undefined : bindingFor(config.value.bindings, requirer, reference);
}

export function bindingsFrom(context: Context, name: string): readonly RequiredBinding[] {
  const mode = context.modes.get(name);
  const references = mode === undefined ? [] : requiredReferences(mode.value);
  return references.flatMap((reference) => {
    const bound = boundModeOf(context, name, reference);
    return bound === undefined ? [] : [{ reference, bound }];
  });
}
