import { dirname } from "node:path/posix";
import type { Interface } from "../generated/interface.ts";
import { problemAt, type Loaded } from "../value-check.ts";
import type { Problem } from "../outcome.ts";
import { schemaDirections } from "./schemas.ts";
import { type ModeSource, type Context, type ActionPlace, actionLabel, actionsOf } from "./loaded.ts";
import { type ImplementedSignature, namingSignatures } from "./action-schemas.ts";
import { interfaceReference, unknownInterface } from "./interfaces.ts";

function extraEffectProblems(place: ActionPlace, implemented: ImplementedSignature): readonly Problem[] {
  const { reference, signature } = implemented;
  const allowed = signature.effects.length === 0 ? "none" : signature.effects.join(", ");
  return place.action.effects
    .filter((effect) => !signature.effects.includes(effect))
    .map((effect) =>
      problemAt(place.mode, ["actions", place.name, "effects"], {
        message: `${actionLabel(place)} has the effect ${effect}, which ${reference} does not allow for ${place.name}.`,
        fix: `Remove ${effect} from the effects of ${place.name}; ${reference} allows: ${allowed}.`,
      }),
    );
}

function givenSchemaProblems(place: ActionPlace, implemented: ImplementedSignature): readonly Problem[] {
  return schemaDirections.flatMap((direction) => {
    const given = place.action[direction];
    if (given === undefined) {
      return [];
    }
    return [
      problemAt(place.mode, ["actions", place.name, direction], {
        message:
          `${actionLabel(place)} gives the ${direction} schema ${given}, ` +
          `but ${implemented.reference} names ${place.name}.`,
        fix:
          `Remove ${direction} from ${place.name}; ` +
          "an action that an interface names takes its input and output from the interface.",
      }),
    ];
  });
}

function signatureProblems(mode: ModeSource, definition: Loaded<Interface>): readonly Problem[] {
  const reference = interfaceReference(definition.value);
  const folder = dirname(definition.file);
  const problems: Problem[] = [];
  for (const [name, signature] of Object.entries(definition.value.actions)) {
    const action = mode.value.actions[name];
    if (action === undefined) {
      problems.push(
        problemAt(mode, ["actions"], {
          message: `Mode ${mode.value.name} implements ${reference} but has no action ${name}.`,
          fix: `Add the action ${name} with effects that ${reference} allows; it takes its input and output from ${reference}.`,
        }),
      );
      continue;
    }
    const place = { mode, name, action };
    problems.push(...extraEffectProblems(place, { reference, signature, folder }));
    problems.push(...givenSchemaProblems(place, { reference, signature, folder }));
  }
  return problems;
}

function missingSchemaProblems(place: ActionPlace): readonly Problem[] {
  const modeName = place.mode.value.name;
  return schemaDirections
    .filter((direction) => place.action[direction] === undefined)
    .map((direction) =>
      problemAt(place.mode, ["actions", place.name], {
        message:
          `${actionLabel(place)} gives no ${direction} schema, ` +
          `and no interface that ${modeName} implements names ${place.name}.`,
        fix: `Add ${direction}: with the JSON Schema file of the ${direction} of ${place.name}.`,
      }),
    );
}

function namedTwiceProblem(place: ActionPlace, named: readonly ImplementedSignature[]): Problem {
  const references = named.map((entry) => entry.reference).join(", ");
  return problemAt(place.mode, ["actions", place.name], {
    message: `${actionLabel(place)} is named by more than one interface that it implements: ${references}.`,
    fix:
      `Keep only one of ${references} in the implements of ${place.mode.value.name}, ` +
      `or rename ${place.name} in all but one of them.`,
  });
}

function schemaSourceProblems(context: Context, mode: ModeSource): readonly Problem[] {
  const implemented = mode.value.implements ?? [];
  if (implemented.some((reference) => !context.interfaces.has(reference))) {
    return [];
  }
  return actionsOf(mode).flatMap((place) => {
    const named = namingSignatures(context, place);
    if (named.length > 1) {
      return [namedTwiceProblem(place, named)];
    }
    return named.length === 0 ? missingSchemaProblems(place) : [];
  });
}

export function implementsProblems(context: Context, mode: ModeSource): readonly Problem[] {
  const problems: Problem[] = [...schemaSourceProblems(context, mode)];
  for (const [index, reference] of (mode.value.implements ?? []).entries()) {
    const definition = context.interfaces.get(reference);
    if (definition === undefined) {
      const subject = `Mode ${mode.value.name} implements`;
      problems.push(problemAt(mode, ["implements", index], unknownInterface(context, subject, reference)));
      continue;
    }
    problems.push(...signatureProblems(mode, definition));
  }
  return problems;
}
