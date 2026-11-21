import { problemAt, type PathSegments } from "../value-check.ts";
import type { Problem } from "../outcome.ts";
import type { Action } from "../generated/mode.ts";
import { type Context, type ActionPlace, type ModeSource, actionLabel } from "./loaded.ts";
import { boundModeOf } from "./bindings.ts";
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

export const keptOutputGoesOnlyToScripts = "the kernel hands a kept output only to a script that calls the action";

function actionNamed(context: Context, requirer: ModeSource, reference: string): Action | undefined {
  const separator = reference.indexOf(".");
  if (separator < 0) {
    return requirer.value.actions[reference];
  }
  const name = reference.slice(0, separator);
  const required = requiredReferences(requirer.value).find((candidate) => interfaceName(candidate) === name);
  const bound = required === undefined ? undefined : boundModeOf(context, requirer.value.name, required);
  const served = bound === undefined ? undefined : context.modes.get(bound.mode);
  return served?.value.actions[reference.slice(separator + 1)];
}

export function keepsOutputPacked(context: Context, requirer: ModeSource, reference: string): boolean {
  return actionNamed(context, requirer, reference)?.skillOutput === "kept-packed";
}

type KeptCallStep = {
  readonly said: string;
  readonly passed: string;
  readonly fix: string;
};

function keptCallStepProblem(place: ActionPlace, step: CallStep, kept: KeptCallStep): Problem {
  return problemAt(place.mode, ["actions", place.name, "run", step.index, "call"], {
    message: `${kept.said}; a call step would pass ${kept.passed} on as text, and ${keptOutputGoesOnlyToScripts}.`,
    fix: kept.fix,
  });
}

function keptCallProblems(context: Context, place: ActionPlace, step: CallStep): readonly Problem[] {
  if (!keepsOutputPacked(context, place.mode, step.call)) {
    return [];
  }
  const said = `${actionLabel(place)} calls ${step.call}, which keeps its skill's output packed`;
  const fix = `Call ${step.call} from a script with context.call.`;
  return [keptCallStepProblem(place, step, { said, passed: "that output", fix })];
}

function keptAnswerProblems(place: ActionPlace, step: CallStep): readonly Problem[] {
  if (place.action.calledOutputs !== "kept-packed") {
    return [];
  }
  const said = `${actionLabel(place)} keeps the answers of the actions it calls packed, but its run has a call step`;
  const fix = `Call ${step.call} from a script with context.call, or leave out calledOutputs.`;
  return [keptCallStepProblem(place, step, { said, passed: "that answer", fix })];
}

function keptRunProblems(place: ActionPlace): readonly Problem[] {
  const [first, ...others] = place.action.run;
  const oneSkill = first !== undefined && "skill" in first && others.length === 0;
  if (place.action.skillOutput !== "kept-packed" || oneSkill) {
    return [];
  }
  return [
    problemAt(place.mode, ["actions", place.name, "run"], {
      message:
        `${actionLabel(place)} keeps its skill's output packed, but its run is not one skill step alone; ` +
        "the kernel hands a kept output only to the script that called the action, so the action has no other step.",
      fix: `Make the run of ${place.name} one skill step, or leave out skillOutput.`,
    }),
  ];
}

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
  const callSteps = place.action.run.flatMap((step, index) => ("call" in step ? [{ call: step.call, index }] : []));
  const calls = callSteps.flatMap((step) => callProblems(context, place, step));
  const keptCalls = callSteps.flatMap((step) => keptCallProblems(context, place, step));
  const keptAnswers = callSteps.flatMap((step) => keptAnswerProblems(place, step));
  return [...calls, ...keptCalls, ...keptAnswers, ...keptRunProblems(place), ...undoProblems(place)];
}
