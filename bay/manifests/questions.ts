import { resolveInput, resolveValue } from "./references.ts";
import { failedWith, succeededWith, unplacedProblem, type Outcome } from "../outcome.ts";
import type { ActiveMode, ActionTarget, WorkflowTarget, System } from "./manifests.ts";
import { interfaceName, requiredReferences } from "./interfaces.ts";
import { servingMode } from "./bindings.ts";
import { actionsListing } from "./listing.ts";

function splitReference(reference: string): readonly [string, string] | undefined {
  const separator = reference.indexOf(".");
  if (separator <= 0 || separator === reference.length - 1) {
    return undefined;
  }
  return [reference.slice(0, separator), reference.slice(separator + 1)];
}

export function refused(message: string): Outcome<never> {
  return failedWith([unplacedProblem(message)]);
}

function notActiveRefusal(name: string): Outcome<never> {
  return failedWith([
    unplacedProblem(
      `Mode ${name} is not active in this project, so nothing of it runs here.`,
      `Add ${name} to modes: in agentbay.config.yaml, or bind an interface it implements.`,
    ),
  ]);
}

function activeModeNamed(system: System, name: string): Outcome<ActiveMode> {
  if (system.inactive.has(name)) {
    return notActiveRefusal(name);
  }
  const mode = system.modes.get(name);
  return mode === undefined ? refused(`There is no mode ${name}.`) : succeededWith(mode);
}

function ownAction(mode: ActiveMode, name: string): Outcome<ActionTarget> {
  const action = Object.hasOwn(mode.manifest.actions, name) ? mode.manifest.actions[name] : undefined;
  const schemas = mode.actionSchemas.get(name);
  if (action === undefined || schemas === undefined) {
    const known = Object.keys(mode.manifest.actions).join(", ");
    return refused(`Mode ${mode.manifest.name} has no action ${name}; it has: ${known}.`);
  }
  return succeededWith({ mode, name, action, caller: undefined, input: schemas.input, output: schemas.output });
}

function boundAction(system: System, caller: ActiveMode, call: string): Outcome<ActionTarget> {
  const parts = splitReference(call);
  if (parts === undefined) {
    return refused(`${call} does not name an action of an interface; write <interface>.<action>.`);
  }
  const [name, actionName] = parts;
  const callerName = caller.manifest.name;
  const required = requiredReferences(caller.manifest).find((reference) => interfaceName(reference) === name);
  if (required === undefined) {
    return refused(`Mode ${callerName} calls ${call}, but it does not require the interface ${name}.`);
  }
  const served = servingMode(system, callerName, required);
  const mode = served === undefined ? undefined : system.modes.get(served);
  if (mode === undefined) {
    return refused(`Mode ${callerName} calls ${call}, but no mode is bound to ${required} for it.`);
  }
  const target = ownAction(mode, actionName);
  return target.ok ? succeededWith({ ...target.value, caller: callerName }) : target;
}

function actionAnswer(system: System, reference: string, caller: string | undefined): Outcome<ActionTarget> {
  if (caller !== undefined) {
    const callerMode = activeModeNamed(system, caller);
    if (!callerMode.ok) {
      return callerMode;
    }
    return reference.includes(".")
      ? boundAction(system, callerMode.value, reference)
      : ownAction(callerMode.value, reference);
  }
  const parts = splitReference(reference);
  if (parts === undefined) {
    return refused(`${reference} does not name an action; write <mode>.<action>.`);
  }
  const mode = activeModeNamed(system, parts[0]);
  return mode.ok ? ownAction(mode.value, parts[1]) : mode;
}

function workflowAnswer(system: System, modeName: string, path: string): Outcome<WorkflowTarget> {
  if (system.inactive.has(modeName)) {
    return notActiveRefusal(modeName);
  }
  const mode = system.modes.get(modeName);
  const workflow = mode?.workflows.get(path);
  if (mode === undefined || workflow === undefined) {
    return refused(`Mode ${modeName} has no workflow ${path}.`);
  }
  const resolve: WorkflowTarget["resolve"] = (value, scope) => {
    const withSettings = { ...scope, settings: mode.settings };
    return typeof value === "string" ? resolveValue(value, withSettings) : resolveInput(value, withSettings);
  };
  return succeededWith({ mode, path, workflow, resolve });
}

type SystemData = Pick<System, "modes" | "inactive" | "interfaces" | "config">;

export function answering(data: SystemData): System {
  return {
    ...data,
    action(reference, caller) {
      return actionAnswer(this, reference, caller);
    },
    workflow(mode, path) {
      return workflowAnswer(this, mode, path);
    },
    listing(question) {
      return actionsListing(this, question);
    },
  };
}
