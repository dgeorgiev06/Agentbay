import { join } from "node:path/posix";
import { granted, listed } from "../answers.ts";
import type { ModeGrants } from "../contracts.ts";
import type { Layout } from "../layout.ts";
import type { FileInspector } from "../ports.ts";
import type { NameableSchemas } from "../schema-files.ts";
import { checkPath } from "./file-access.ts";
import type { OperationName } from "./operations.ts";
import {
  allowedWith,
  answered,
  askingSentence,
  type Definition,
  type Entries,
  refusedWith,
  type SchemaNaming,
  type Step,
} from "./rule.ts";

type SchemaOperationName = Extract<OperationName, "schemas.read">;

type NamedSchema = { readonly file: string };

export type SchemaPlaces = {
  readonly grants: ModeGrants;
  readonly layout: Layout;
  readonly inspector: FileInspector;
  readonly interfaceSchemas: NameableSchemas;
};

const interfaceNamed = /^[^/]*@/;

const namingChange = "Name one of those, written <file> or <interface>@<major>/<file>.";

function isOwnSchemaName(name: string): boolean {
  const parts = name.split("/");
  return (
    name.endsWith(".json") &&
    !name.startsWith("/") &&
    !interfaceNamed.test(name) &&
    !parts.includes("..") &&
    !parts.includes("")
  );
}

function declaredSchemas(places: SchemaPlaces): string {
  const interfaceNames = [...places.interfaceSchemas.files.keys()];
  return (
    `the mode ${places.grants.mode} may name the .json files in its own folder and the schemas of the ` +
    `interfaces it implements or requires: ${listed(interfaceNames, "none")}`
  );
}

export function schemaNaming(places: SchemaPlaces): (name: string) => Promise<SchemaNaming> {
  return async (name) => {
    const interfaceFile = places.interfaceSchemas.files.get(name);
    if (interfaceFile !== undefined) {
      return { named: true, file: interfaceFile };
    }
    if (!isOwnSchemaName(name)) {
      return { named: false, declared: declaredSchemas(places), change: namingChange };
    }
    const { modeFolder } = places.grants;
    const path = join(modeFolder, name);
    const check = await checkPath(places.inspector, {
      layout: places.layout,
      path,
      permitted: [modeFolder],
      purpose: "read",
    });
    if (check.status !== "allowed") {
      return {
        named: false,
        declared: `a link on that path leads outside the folder of the mode ${places.grants.mode}`,
        change: "Remove the link: a mode may not reach files through a link that leaves its folders.",
      };
    }
    return { named: true, file: check.path };
  };
}

const schemasRead: Definition<"schemas.read", NamedSchema> = {
  operation: "schemas.read",
  needs: () => [],
  described: (request) => `check a value against the schema ${request.schema}`,
  rule: async (request, asking) => {
    const naming = await asking.schemaNamed(request.schema);
    if (naming.named) {
      return allowedWith({ file: naming.file });
    }
    return refusedWith({
      resource: "schemas",
      asked: `${askingSentence(asking)} to check a value against the schema ${request.schema}`,
      declared: naming.declared,
      change: naming.change,
    });
  },
  handler: async (named, doing) => granted(await doing.readSchema(named.file)),
  refusalDetail: (request) => ({ schema: request.schema }),
};

export function schemaEntries(step: Step): Entries<SchemaOperationName> {
  return { "schemas.read": (request) => answered(schemasRead, request, step) };
}
