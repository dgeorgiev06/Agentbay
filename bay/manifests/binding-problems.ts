import type { Config } from "../generated/config.ts";
import { problemAt, type Loaded } from "../value-check.ts";
import type { Problem } from "../outcome.ts";
import { type ModeSource, type Context, activeModesOf } from "./loaded.ts";
import {
  interfaceName,
  requiredReferences,
  implementersOf,
  unknownInterface,
  candidatesOf,
  requirersOf,
} from "./interfaces.ts";
import { defaultKey, boundModeOf } from "./bindings.ts";

type Requirement = {
  readonly requirer: string;
  readonly reference: string;
};

function notBoundProblem(context: Context, config: Loaded<Config>, requirement: Requirement): Problem {
  const { requirer, reference } = requirement;
  const name = interfaceName(reference);
  const candidates = candidatesOf(context, reference);
  if (!Object.hasOwn(config.value.bindings, name)) {
    return problemAt(config, ["bindings"], {
      message: `Mode ${requirer} requires ${reference}, but bindings names no mode for ${name}.`,
      fix: `Add ${name}: <mode> under bindings; modes that implement ${reference}: ${candidates}.`,
    });
  }
  const missing = `bindings.${name} has no entry for ${requirer} and no default`;
  return problemAt(config, ["bindings", name], {
    message: `Mode ${requirer} requires ${reference}, but ${missing}.`,
    fix:
      `Add ${requirer}: <mode> or default: <mode> under bindings.${name}; ` +
      `modes that implement ${reference}: ${candidates}.`,
  });
}

function boundModeProblem(context: Context, requirer: string, reference: string): Problem | undefined {
  const config = context.config;
  if (config === undefined) {
    return undefined;
  }
  const bound = boundModeOf(context, requirer, reference);
  if (bound === undefined) {
    return notBoundProblem(context, config, { requirer, reference });
  }
  const candidates = candidatesOf(context, reference);
  const name = interfaceName(reference);
  if (context.unloadedModes.has(bound.mode)) {
    return problemAt(config, bound.path, {
      message: `bindings binds ${bound.label} to ${bound.mode}, which does not load; its own problems are listed.`,
      fix: `Correct the manifest of ${bound.mode}, or bind ${name} to another mode that implements ${reference}.`,
    });
  }
  if (!context.modes.has(bound.mode)) {
    return problemAt(config, bound.path, {
      message: `bindings binds ${bound.label} to ${bound.mode}, which is not a mode.`,
      fix: `Bind ${name} to a mode that implements ${reference}: ${candidates}.`,
    });
  }
  if (!implementersOf(context, reference).includes(bound.mode)) {
    return problemAt(config, bound.path, {
      message:
        `bindings binds ${bound.label} to ${bound.mode}, which does not implement ${reference}, ` +
        `as mode ${requirer} requires.`,
      fix:
        `Bind ${name} to a mode that implements ${reference} (${candidates}), ` +
        `or add ${reference} to the implements of ${bound.mode}.`,
    });
  }
  return undefined;
}

function mapEntryProblem(
  context: Context,
  at: { name: string; key: string },
  config: Loaded<Config>,
): readonly Problem[] {
  const { name, key } = at;
  if (key === defaultKey || context.unloadedModes.has(key)) {
    return [];
  }
  if (!context.modes.has(key)) {
    return [
      problemAt(config, ["bindings", name, key], {
        message: `bindings.${name} has an entry for ${key}, which is not a mode.`,
        fix: `Correct the name, or remove ${key} from bindings.${name}.`,
      }),
    ];
  }
  if (requirersOf(context, name).includes(key)) {
    return [];
  }
  return [
    problemAt(config, ["bindings", name, key], {
      message: `bindings.${name} has an entry for ${key}, but mode ${key} does not require ${name}.`,
      fix: `Remove ${key} from bindings.${name}, or add ${name}@<major> to requires.interfaces of ${key}.`,
    }),
  ];
}

export function bindingMapProblems(context: Context): readonly Problem[] {
  const config = context.config;
  if (config === undefined) {
    return [];
  }
  return Object.entries(config.value.bindings).flatMap(([name, binding]) =>
    typeof binding === "string"
      ? []
      : Object.keys(binding).flatMap((key) => mapEntryProblem(context, { name, key }, config)),
  );
}

export function requiresProblems(context: Context, mode: ModeSource): readonly Problem[] {
  return requiredReferences(mode.value).flatMap((reference, index) => {
    if (!context.interfaces.has(reference)) {
      const subject = `Mode ${mode.value.name} requires`;
      return [problemAt(mode, ["requires", "interfaces", index], unknownInterface(context, subject, reference))];
    }
    return boundModeProblem(context, mode.value.name, reference) ?? [];
  });
}

function dependencyGraph(context: Context): ReadonlyMap<string, readonly string[]> {
  const graph = new Map<string, readonly string[]>();
  for (const mode of activeModesOf(context)) {
    const name = mode.value.name;
    const dependencies = requiredReferences(mode.value).flatMap((reference) => {
      const bound = boundModeOf(context, name, reference)?.mode;
      return bound !== undefined && context.modes.has(bound) ? [bound] : [];
    });
    graph.set(name, dependencies);
  }
  return graph;
}

function cyclesOf(graph: ReadonlyMap<string, readonly string[]>): readonly (readonly string[])[] {
  const cycles: (readonly string[])[] = [];
  const finished = new Set<string>();
  const visit = (node: string, path: readonly string[]): void => {
    const start = path.indexOf(node);
    if (start >= 0) {
      cycles.push([...path.slice(start), node]);
      return;
    }
    if (finished.has(node)) {
      return;
    }
    for (const next of graph.get(node) ?? []) {
      visit(next, [...path, node]);
    }
    finished.add(node);
  };
  for (const node of [...graph.keys()].sort()) {
    visit(node, []);
  }
  return cycles;
}

export function cycleProblems(context: Context): readonly Problem[] {
  const config = context.config;
  if (config === undefined) {
    return [];
  }
  return cyclesOf(dependencyGraph(context)).map((cycle) =>
    problemAt(config, ["bindings"], {
      message: `Modes depend on each other in a cycle through bindings: ${cycle.join(" -> ")}.`,
      fix: "Change requires or bindings so that no mode depends, directly or through other modes, on itself.",
    }),
  );
}
