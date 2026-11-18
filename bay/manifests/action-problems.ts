import { problemAt, type PathSegments } from "../value-check.ts";
import type { Problem } from "../outcome.ts";
import { type Context, type ActionPlace, actionLabel } from "./loaded.ts";
import { interfaceName, requiredReferences } from "./interfaces.ts";

type CallStep = {
  readonly call: string;
  readonly index: number;
};

type CallTarget = {
  readonly reference: string;
  readonly actionName: string;
  readonly known: readonly string[];
};

function notRequiredProblem(place: ActionPlace, path: PathSegments, step: CallStep): Problem {
  const name = step.call.slice(0, step.call.indexOf("."));
  return problemAt(place.mode, path, {
    message: `${actionLabel(place)} calls ${step.call}, but mode ${place.mode.value.name} does not require ${name}.`,
    fix: `Add ${name}@<major> to requires.interfaces of ${place.mode.value.name}.`,
  });
}

function noSuchActionProblem(place: ActionPlace, path: PathSegments, target: CallTarget): Problem {
  return problemAt(place.mode, path, {
    message: `${actionLabel(place)} calls ${target.actionName} of ${target.reference}, which has no such action.`,
    fix: `Call one of the actions of ${target.reference}: ${target.known.join(", ")}.`,
  });
}

function callProblems(context: Context, place: ActionPlace, step: CallStep): readonly Problem[] {
  const path = ["actions", place.name, "run", step.index, "call"];
  const name = step.call.slice(0, step.call.indexOf("."));
  const actionName = step.call.slice(step.call.indexOf(".") + 1);
  const reference = requiredReferences(place.mode.value).find((required) => interfaceName(required) === name);
  if (reference === undefined) {
    return [notRequiredProblem(place, path, step)];
  }
  const definition = context.interfaces.get(reference);
  if (definition === undefined) {
    return [];
  }
  const signature = definition.value.actions[actionName];
  if (signature === undefined) {
    const known = Object.keys(definition.value.actions);
    return [noSuchActionProblem(place, path, { reference, actionName, known })];
  }
  return signature.effects
    .filter((effect) => !place.action.effects.includes(effect))
    .map((effect) =>
      problemAt(place.mode, path, {
        message:
          `${actionLabel(place)} calls ${step.call}, which may have the effect ${effect}, ` +
          `but ${place.name} does not declare it.`,
        fix: `Add ${effect} to the effects of ${place.name}.`,
      }),
    );
}

function undoProblems(place: ActionPlace): readonly Problem[] {
  const undo = place.action.undo;
  if (undo === undefined) {
    return [];
  }
  const path = ["actions", place.name, "undo"];
  const modeName = place.mode.value.name;
  if (undo === place.name) {
    return [
      problemAt(place.mode, path, {
        message: `${actionLabel(place)} names itself as its undo.`,
        fix: `Name another action of ${modeName} that reverses ${place.name}, or remove undo.`,
      }),
    ];
  }
  const target = place.mode.value.actions[undo];
  if (target === undefined) {
    return [
      problemAt(place.mode, path, {
        message: `${actionLabel(place)} names undo: ${undo}, but mode ${modeName} has no action ${undo}.`,
        fix: `Name an action of ${modeName}, or add the action ${undo}.`,
      }),
    ];
  }
  if (target.undo === place.name && place.name < undo) {
    return [
      problemAt(place.mode, path, {
        message: `Actions ${place.name} and ${undo} of mode ${modeName} each name the other as undo.`,
        fix: `Remove undo from one of them; an undo action is not itself undone.`,
      }),
    ];
  }
  return [];
}

export function actionProblems(context: Context, place: ActionPlace): readonly Problem[] {
  const calls = place.action.run.flatMap((step, index) =>
    "call" in step ? callProblems(context, place, { call: step.call, index }) : [],
  );
  return [...calls, ...undoProblems(place)];
}
