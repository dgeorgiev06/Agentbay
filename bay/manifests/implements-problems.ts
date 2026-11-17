import { dirname, join } from "node:path/posix";
import { isDeepStrictEqual } from "node:util";
import type { Interface } from "../generated/interface.ts";
import { problemAt, type Loaded } from "./spec.ts";
import type { Problem } from "../outcome.ts";
import { type SchemaReader, schemaDirections } from "./schemas.ts";
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

async function shapeProblems(
  readSchema: SchemaReader,
  place: ActionPlace,
  implemented: ImplementedSignature,
): Promise<readonly Problem[]> {
  const problems: Problem[] = [];
  for (const direction of schemaDirections) {
    const ownPath = place.action[direction];
    if (ownPath === undefined) {
      continue;
    }
    const declaredPath = implemented.signature[direction];
    const own = await readSchema(join(place.mode.folder, ownPath));
    const declared = await readSchema(join(implemented.folder, declaredPath));
    if (own.state !== "valid" || declared.state !== "valid" || isDeepStrictEqual(own.schema, declared.schema)) {
      continue;
    }
    problems.push(
      problemAt(place.mode, ["actions", place.name, direction], {
        message:
          `${actionLabel(place)} has the ${direction} schema ${ownPath}, ` +
          `which differs from ${declaredPath} that ${implemented.reference} declares.`,
        fix: "Make the two schemas the same; an implementation takes and returns exactly what its interface says.",
      }),
    );
  }
  return problems;
}

async function signatureProblems(
  readSchema: SchemaReader,
  mode: ModeSource,
  definition: Loaded<Interface>,
): Promise<readonly Problem[]> {
  const reference = interfaceReference(definition.value);
  const folder = dirname(definition.file);
  const problems: Problem[] = [];
  for (const [name, signature] of Object.entries(definition.value.actions)) {
    const action = mode.value.actions[name];
    if (action === undefined) {
      problems.push(
        problemAt(mode, ["actions"], {
          message: `Mode ${mode.value.name} implements ${reference} but has no action ${name}.`,
          fix: `Add the action ${name} with the input, output and effects that ${reference} declares.`,
        }),
      );
      continue;
    }
    const place = { mode, name, action };
    problems.push(...extraEffectProblems(place, { reference, signature, folder }));
    problems.push(...(await shapeProblems(readSchema, place, { reference, signature, folder })));
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

export async function implementsProblems(context: Context, mode: ModeSource): Promise<readonly Problem[]> {
  const problems: Problem[] = [...schemaSourceProblems(context, mode)];
  for (const [index, reference] of (mode.value.implements ?? []).entries()) {
    const definition = context.interfaces.get(reference);
    if (definition === undefined) {
      const subject = `Mode ${mode.value.name} implements`;
      problems.push(problemAt(mode, ["implements", index], unknownInterface(context, subject, reference)));
      continue;
    }
    problems.push(...(await signatureProblems(context.readSchema, mode, definition)));
  }
  return problems;
}
