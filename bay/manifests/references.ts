import type { Json } from "../contracts.ts";
import type { Choice, Step as WorkflowStep } from "../generated/workflow.ts";
import { toJson, isRecord } from "../json.ts";
import { failedWith, problemText, succeededWith, unplacedProblem, type Outcome, type Problem } from "../outcome.ts";
import type { PathSegments, Wording } from "../value-check.ts";

type Reference =
  | { readonly kind: "trigger"; readonly text: string }
  | { readonly kind: "item"; readonly text: string }
  | { readonly kind: "settings"; readonly text: string; readonly key: string }
  | { readonly kind: "steps"; readonly text: string; readonly id: string; readonly path: readonly string[] };

type ReferenceScope = {
  readonly trigger: Json;
  readonly outputs: ReadonlyMap<string, Json>;
  readonly item?: Json;
  readonly settings: Readonly<Record<string, unknown>>;
};

type ReferenceIssue = Wording & { readonly path: PathSegments };

type ReferencePlace = {
  readonly text: string;
  readonly path: PathSegments;
  readonly ruleOf?: string;
};

type StaticScope = {
  readonly earlier: readonly string[];
  readonly insideForeach: boolean;
};

const stepsPattern = /^\$steps\.([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\.output((?:\.[A-Za-z0-9_-]+)*)$/;

const settingsPattern = /^\$settings\.([A-Za-z0-9_-]+)$/;

const grammar =
  "write $trigger, $item, $settings.<key> or $steps.<id>.output with an optional dotted path such as .items.0";

function isReferenceText(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("$");
}

function parseReference(text: string): Outcome<Reference> {
  if (text === "$trigger") {
    return succeededWith({ kind: "trigger", text });
  }
  if (text === "$item") {
    return succeededWith({ kind: "item", text });
  }
  const settings = settingsPattern.exec(text);
  if (settings?.[1] !== undefined) {
    return succeededWith({ kind: "settings", text, key: settings[1] });
  }
  const steps = stepsPattern.exec(text);
  if (steps?.[1] !== undefined) {
    const path = (steps[2] ?? "").split(".").filter((segment) => segment !== "");
    return succeededWith({ kind: "steps", text, id: steps[1], path });
  }
  const message = `${text} is not a reference: ${grammar}. Every value that starts with $ is read as a reference.`;
  return failedWith([unplacedProblem(message)]);
}

function listed(names: readonly string[]): string {
  return names.length === 0 ? "none" : names.join(", ");
}

function keysOf(value: Json): string {
  if (Array.isArray(value)) {
    return `a list of ${String(value.length)} elements`;
  }
  if (isRecord(value)) {
    return `a mapping with the keys ${listed(Object.keys(value))}`;
  }
  return `the value ${JSON.stringify(value)}`;
}

function childOf(value: Json, segment: string): Json | undefined {
  if (Array.isArray(value)) {
    const index = /^(0|[1-9][0-9]*)$/.test(segment) ? Number(segment) : -1;
    return index >= 0 && index < value.length ? toJson(value[index]) : undefined;
  }
  if (isRecord(value) && Object.hasOwn(value, segment)) {
    return toJson(value[segment]);
  }
  return undefined;
}

function followPath(reference: Reference & { readonly kind: "steps" }, output: Json): Outcome<Json> {
  let current = output;
  for (const [index, segment] of reference.path.entries()) {
    const next = childOf(current, segment);
    if (next === undefined) {
      const walked = ["output", ...reference.path.slice(0, index)].join(".");
      const problem =
        `${reference.text} resolves to nothing: ${walked} of step ${reference.id} has no ${segment}; ` +
        `it is ${keysOf(current)}.`;
      return failedWith([unplacedProblem(problem)]);
    }
    current = next;
  }
  return { ok: true, value: current };
}

function resolveSteps(reference: Reference & { readonly kind: "steps" }, scope: ReferenceScope): Outcome<Json> {
  const output = scope.outputs.get(reference.id);
  if (output === undefined) {
    const available = listed([...scope.outputs.keys()]);
    const problem =
      `${reference.text} resolves to nothing: no step ${reference.id} has finished before it ` +
      `(available: ${available}).`;
    return failedWith([unplacedProblem(problem)]);
  }
  return followPath(reference, output);
}

function resolveSettings(reference: Reference & { readonly kind: "settings" }, scope: ReferenceScope): Outcome<Json> {
  if (!Object.hasOwn(scope.settings, reference.key)) {
    const available = listed(Object.keys(scope.settings));
    const problem =
      `${reference.text} resolves to nothing: the mode's settings have no ${reference.key} ` +
      `(available: ${available}).`;
    return failedWith([unplacedProblem(problem)]);
  }
  return { ok: true, value: toJson(scope.settings[reference.key]) };
}

function resolveReference(reference: Reference, scope: ReferenceScope): Outcome<Json> {
  switch (reference.kind) {
    case "trigger":
      return { ok: true, value: scope.trigger };
    case "item":
      if (scope.item === undefined) {
        return failedWith([unplacedProblem("$item resolves to nothing: it is used outside a foreach.")]);
      }
      return { ok: true, value: scope.item };
    case "settings":
      return resolveSettings(reference, scope);
    case "steps":
      return resolveSteps(reference, scope);
  }
}

export function resolveValue(value: unknown, scope: ReferenceScope): Outcome<Json> {
  if (!isReferenceText(value)) {
    return { ok: true, value: toJson(value) };
  }
  const parsed = parseReference(value);
  return parsed.ok ? resolveReference(parsed.value, scope) : parsed;
}

export function resolveInput(input: Readonly<Record<string, unknown>>, scope: ReferenceScope): Outcome<Json> {
  const resolved: Record<string, Json> = {};
  const problems: Problem[] = [];
  for (const [key, value] of Object.entries(input)) {
    const resolution = resolveValue(value, scope);
    if (resolution.ok) {
      resolved[key] = resolution.value;
    } else {
      problems.push(
        ...resolution.problems.map((problem) => ({ ...problem, message: `input.${key}: ${problem.message}` })),
      );
    }
  }
  return problems.length === 0 ? succeededWith(resolved) : failedWith(problems);
}

function rulePlaces(choices: Readonly<Record<string, Choice>>, path: PathSegments): readonly ReferencePlace[] {
  return Object.entries(choices).flatMap(([name, choice]) =>
    choice.when === undefined ? [] : [{ text: choice.when, path: [...path, name, "when"], ruleOf: name }],
  );
}

function referencePlaces(step: WorkflowStep, path: PathSegments): readonly ReferencePlace[] {
  if ("action" in step) {
    return Object.entries(step.input ?? {}).flatMap(([key, value]) =>
      isReferenceText(value) ? [{ text: value, path: [...path, "input", key] }] : [],
    );
  }
  if ("approval" in step) {
    const shown = step.show === undefined ? [] : [{ text: step.show, path: [...path, "show"] }];
    return [...shown, ...rulePlaces(step.choices ?? {}, [...path, "choices"])];
  }
  if ("foreach" in step) {
    return [{ text: step.foreach, path: [...path, "foreach"] }];
  }
  return [];
}

function scopeIssue(reference: Reference, scope: StaticScope): Wording | undefined {
  switch (reference.kind) {
    case "trigger":
    case "settings":
      return undefined;
    case "item":
      return scope.insideForeach
        ? undefined
        : { message: "$item is used outside a foreach.", fix: "Use $item only in the steps of a foreach." };
    case "steps":
      return scope.earlier.includes(reference.id)
        ? undefined
        : {
            message:
              `${reference.text} names the step ${reference.id}, which is not defined before this step ` +
              `in its scope (earlier steps: ${listed(scope.earlier)}).`,
            fix: "Name a step that comes earlier in the same list of steps or in a list that encloses it.",
          };
  }
}

function ruleIssue(reference: Reference, ruleOf: string | undefined): Wording | undefined {
  if (ruleOf === undefined || reference.kind === "steps") {
    return undefined;
  }
  return {
    message:
      `the rule of the choice ${ruleOf} is ${reference.text}, ` +
      "but a rule reads an earlier step's output: $steps.<id>.output with an optional path.",
    fix: "Name the output of an earlier step that is true or false, such as one a script computed.",
  };
}

function placeIssues(place: ReferencePlace, scope: StaticScope): readonly ReferenceIssue[] {
  const parsed = parseReference(place.text);
  if (!parsed.ok) {
    return [{ path: place.path, message: problemText(parsed.problems), fix: `Correct the reference: ${grammar}.` }];
  }
  const issues = [ruleIssue(parsed.value, place.ruleOf), scopeIssue(parsed.value, scope)];
  return issues.flatMap((issue) => (issue === undefined ? [] : [{ path: place.path, ...issue }]));
}

function quoteIssues(step: WorkflowStep, path: PathSegments, earlier: readonly string[]): readonly ReferenceIssue[] {
  const quotes = "approval" in step ? (step.quotes ?? []) : [];
  return quotes.flatMap((id, index) =>
    earlier.includes(id)
      ? []
      : [
          {
            path: [...path, "quotes", index],
            message:
              `the approval quotes the step ${id}, which is not defined before this step in its scope ` +
              `(earlier steps: ${listed(earlier)}).`,
            fix: "Quote a step that comes earlier in the same list of steps or in a list that encloses it.",
          },
        ],
  );
}

function issuesIn(steps: readonly WorkflowStep[], prefix: PathSegments, scope: StaticScope): readonly ReferenceIssue[] {
  const earlier = [...scope.earlier];
  const issues: ReferenceIssue[] = [];
  for (const [index, step] of steps.entries()) {
    const path = [...prefix, "steps", index];
    const current = { earlier: [...earlier], insideForeach: scope.insideForeach };
    issues.push(...referencePlaces(step, path).flatMap((place) => placeIssues(place, current)));
    issues.push(...quoteIssues(step, path, earlier));
    if ("foreach" in step) {
      issues.push(...issuesIn(step.steps, path, { earlier: [...earlier], insideForeach: true }));
    }
    earlier.push(step.id);
  }
  return issues;
}

export function workflowReferenceIssues(steps: readonly WorkflowStep[]): readonly ReferenceIssue[] {
  return issuesIn(steps, [], { earlier: [], insideForeach: false });
}
