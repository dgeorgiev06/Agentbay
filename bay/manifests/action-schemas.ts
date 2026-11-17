import { dirname, join } from "node:path/posix";
import type { Signature } from "../generated/interface.ts";
import type { Context, ActionPlace } from "./loaded.ts";

export type ImplementedSignature = {
  readonly reference: string;
  readonly signature: Signature;
  readonly folder: string;
};

type SchemaFiles = {
  readonly input: string;
  readonly output: string;
};

export function namingSignatures(context: Context, place: ActionPlace): readonly ImplementedSignature[] {
  return (place.mode.value.implements ?? []).flatMap((reference) => {
    const definition = context.interfaces.get(reference);
    if (definition === undefined || !Object.hasOwn(definition.value.actions, place.name)) {
      return [];
    }
    const signature = definition.value.actions[place.name];
    return signature === undefined ? [] : [{ reference, signature, folder: dirname(definition.file) }];
  });
}

function ownSchemaFiles(place: ActionPlace): SchemaFiles | undefined {
  const { input, output } = place.action;
  if (input === undefined || output === undefined) {
    return undefined;
  }
  return { input: join(place.mode.folder, input), output: join(place.mode.folder, output) };
}

export function schemaFilesOf(context: Context, place: ActionPlace): SchemaFiles | undefined {
  const own = ownSchemaFiles(place);
  const [named] = namingSignatures(context, place);
  if (own !== undefined || named === undefined) {
    return own;
  }
  return { input: join(named.folder, named.signature.input), output: join(named.folder, named.signature.output) };
}
