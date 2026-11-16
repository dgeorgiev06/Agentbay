import type { Action } from "../generated/mode.ts";
import { servingMode, type ActiveMode, type System } from "./manifests.ts";

export type ActionTarget = {
  readonly mode: ActiveMode;
  readonly name: string;
  readonly action: Action;
};

function actionOf(mode: ActiveMode, name: string): Action | undefined {
  return Object.hasOwn(mode.manifest.actions, name) ? mode.manifest.actions[name] : undefined;
}

export function splitReference(reference: string): readonly [string, string] | undefined {
  const separator = reference.indexOf(".");
  if (separator <= 0 || separator === reference.length - 1) {
    return undefined;
  }
  return [reference.slice(0, separator), reference.slice(separator + 1)];
}

export function resolveOwnAction(system: System, modeName: string, actionName: string): ActionTarget | string {
  const mode = system.modes.get(modeName);
  if (mode === undefined) {
    return `There is no mode ${modeName}.`;
  }
  const action = actionOf(mode, actionName);
  if (action === undefined) {
    const known = Object.keys(mode.manifest.actions).join(", ");
    return `Mode ${modeName} has no action ${actionName}; it has: ${known}.`;
  }
  return { mode, name: actionName, action };
}

export function resolveActionReference(system: System, reference: string): ActionTarget | string {
  const parts = splitReference(reference);
  if (parts === undefined) {
    return `${reference} does not name an action; write <mode>.<action>.`;
  }
  return resolveOwnAction(system, parts[0], parts[1]);
}

export function resolveCall(system: System, caller: ActiveMode, call: string): ActionTarget | string {
  const parts = splitReference(call);
  if (parts === undefined) {
    return `${call} does not name an action of an interface; write <interface>.<action>.`;
  }
  const [interfaceName, actionName] = parts;
  const required = (caller.manifest.requires?.interfaces ?? []).find((reference) =>
    reference.startsWith(`${interfaceName}@`),
  );
  if (required === undefined) {
    return `Mode ${caller.manifest.name} calls ${call}, but it does not require the interface ${interfaceName}.`;
  }
  const boundMode = servingMode(system, caller.manifest.name, required);
  if (boundMode === undefined) {
    return `Mode ${caller.manifest.name} calls ${call}, but no mode is bound to ${required} for it.`;
  }
  return resolveOwnAction(system, boundMode, actionName);
}

export function resolveNamedAction(system: System, modeName: string, name: string): ActionTarget | string {
  const mode = system.modes.get(modeName);
  if (mode === undefined || !name.includes(".")) {
    return resolveOwnAction(system, modeName, name);
  }
  return resolveCall(system, mode, name);
}
