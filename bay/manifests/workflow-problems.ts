import type { Step as WorkflowStep } from "../generated/workflow.ts";
import { workflowReferenceIssues } from "./references.ts";
import { problemAt, type PathSegments } from "../value-check.ts";
import type { Problem } from "../outcome.ts";
import type { ModeSource, Context, ModeWorkflow } from "./loaded.ts";
import { interfaceName, requiredReferences } from "./interfaces.ts";

type WorkflowStepPlace = {
  readonly step: WorkflowStep;
  readonly path: PathSegments;
};

function workflowStepPlaces(steps: readonly WorkflowStep[], prefix: PathSegments): readonly WorkflowStepPlace[] {
  return steps.flatMap((step, index) => {
    const path = [...prefix, "steps", index];
    const nested = "foreach" in step ? workflowStepPlaces(step.steps, path) : [];
    return [{ step, path }, ...nested];
  });
}

function stepLabel(entry: ModeWorkflow, step: WorkflowStep): string {
  return `Step ${step.id} of workflow ${entry.path} of mode ${entry.mode.value.name}`;
}

function duplicateStepIdProblems(entry: ModeWorkflow): readonly Problem[] {
  const seen = new Set<string>();
  const problems: Problem[] = [];
  for (const place of workflowStepPlaces(entry.loaded.value.steps, [])) {
    if (seen.has(place.step.id)) {
      problems.push(
        problemAt(entry.loaded, [...place.path, "id"], {
          message:
            `Workflow ${entry.path} of mode ${entry.mode.value.name} ` +
            `has more than one step with the id ${place.step.id}.`,
          fix: "Give every step its own id; ids are unique in the whole file, inside foreach steps too.",
        }),
      );
    }
    seen.add(place.step.id);
  }
  return problems;
}

function callableActions(context: Context, mode: ModeSource): readonly string[] {
  const own = Object.keys(mode.value.actions);
  const throughInterfaces = requiredReferences(mode.value).flatMap((reference) => {
    const definition = context.interfaces.get(reference);
    const actions = definition === undefined ? [] : Object.keys(definition.value.actions);
    return actions.map((action) => `${interfaceName(reference)}.${action}`);
  });
  return [...own, ...throughInterfaces];
}

function workflowActionProblem(context: Context, entry: ModeWorkflow, place: WorkflowStepPlace): Problem | undefined {
  const step = place.step;
  if (!("action" in step)) {
    return undefined;
  }
  const callable = callableActions(context, entry.mode);
  if (callable.includes(step.action)) {
    return undefined;
  }
  const path = [...place.path, "action"];
  const modeName = entry.mode.value.name;
  const separator = step.action.indexOf(".");
  const name = step.action.slice(0, separator);
  const required = requiredReferences(entry.mode.value).some((reference) => interfaceName(reference) === name);
  if (separator >= 0 && !required) {
    return problemAt(entry.loaded, path, {
      message: `${stepLabel(entry, step)} names ${step.action}, but mode ${modeName} does not require ${name}.`,
      fix: `Add ${name}@<major> to requires.interfaces of ${modeName}, or name one of: ${callable.join(", ")}.`,
    });
  }
  return problemAt(entry.loaded, path, {
    message:
      `${stepLabel(entry, step)} names the action ${step.action}, which is neither an action of mode ${modeName} ` +
      `nor an action of an interface it requires. Valid names: ${callable.join(", ")}.`,
    fix: "Name one of the valid actions.",
  });
}

function workflowReferenceProblems(entry: ModeWorkflow): readonly Problem[] {
  return workflowReferenceIssues(entry.loaded.value.steps).map((issue) =>
    problemAt(entry.loaded, issue.path, {
      message: `Workflow ${entry.path} of mode ${entry.mode.value.name} has a reference problem: ${issue.message}`,
      ...(issue.fix === undefined ? {} : { fix: issue.fix }),
    }),
  );
}

export function workflowProblems(context: Context, workflows: readonly ModeWorkflow[]): readonly Problem[] {
  const active = workflows.filter((entry) => context.active.has(entry.mode.value.name));
  return active.flatMap((entry) => {
    const actionProblems = workflowStepPlaces(entry.loaded.value.steps, []).flatMap(
      (place) => workflowActionProblem(context, entry, place) ?? [],
    );
    return [...duplicateStepIdProblems(entry), ...actionProblems, ...workflowReferenceProblems(entry)];
  });
}
