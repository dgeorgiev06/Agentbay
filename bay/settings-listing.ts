import { join } from "node:path/posix";
import configSchema from "../schemas/config.schema.json" with { type: "json" };
import type { Json } from "./contracts.ts";
import { toJson } from "./json.ts";
import type { Kernel } from "./kernel.ts";
import { isRecord } from "./spec.ts";

export type Setting = {
  readonly name: string;
  readonly type: string;
  readonly description: string;
  readonly current: Json | undefined;
};

type SchemaPlace = {
  readonly schema: unknown;
  readonly definitions: unknown;
  readonly name: string;
  readonly current: unknown;
};

function resolved(schema: unknown, definitions: unknown): unknown {
  const reference = isRecord(schema) ? schema.$ref : undefined;
  if (typeof reference !== "string" || !reference.startsWith("#/$defs/") || !isRecord(definitions)) {
    return schema;
  }
  const target = definitions[reference.slice("#/$defs/".length)];
  if (!isRecord(target) || !isRecord(schema)) {
    return schema;
  }
  return { ...target, ...Object.fromEntries(Object.entries(schema).filter(([key]) => key !== "$ref")) };
}

function typeOf(schema: unknown): string {
  if (!isRecord(schema)) {
    return "any value";
  }
  if (Array.isArray(schema.enum)) {
    return `one of ${schema.enum.map((value: unknown) => JSON.stringify(value)).join(", ")}`;
  }
  if (schema.type === "array") {
    return `list of ${typeOf(schema.items)}`;
  }
  return typeof schema.type === "string" ? schema.type : "any value";
}

function describedProperties(schema: unknown): readonly (readonly [string, unknown])[] {
  const properties = isRecord(schema) ? schema.properties : undefined;
  return isRecord(properties) ? Object.entries(properties) : [];
}

function settingsAt(place: SchemaPlace): readonly Setting[] {
  const schema = resolved(place.schema, place.definitions);
  const nested = describedProperties(schema);
  if (nested.length > 0 && isRecord(schema) && schema.type === "object") {
    return nested.flatMap(([key, child]) =>
      settingsAt({
        schema: child,
        definitions: place.definitions,
        name: `${place.name}.${key}`,
        current: isRecord(place.current) ? place.current[key] : undefined,
      }),
    );
  }
  const description = isRecord(schema) && typeof schema.description === "string" ? schema.description : "";
  const current = place.current === undefined ? undefined : toJson(place.current);
  return [{ name: place.name, type: typeOf(schema), description, current }];
}

function topLevel(schema: unknown, current: unknown, prefix: string): readonly Setting[] {
  const definitions = isRecord(schema) ? schema.$defs : undefined;
  return describedProperties(schema).flatMap(([key, child]) =>
    settingsAt({
      schema: child,
      definitions,
      name: prefix === "" ? key : `${prefix}.${key}`,
      current: isRecord(current) ? current[key] : undefined,
    }),
  );
}

async function modeSettings(kernel: Kernel): Promise<readonly Setting[]> {
  const settings: Setting[] = [];
  for (const [name, mode] of kernel.system.modes) {
    const file = mode.manifest.settings;
    if (file === undefined) {
      continue;
    }
    const text = await kernel.ports.files.readText(join(kernel.root, mode.folder, file));
    const schema: unknown = text === undefined ? undefined : JSON.parse(text);
    settings.push(...topLevel(schema, mode.settings, `settings.${name}`));
  }
  return settings;
}

export async function listSettings(kernel: Kernel): Promise<readonly Setting[]> {
  const project = topLevel(configSchema, kernel.system.config, "").filter((setting) => setting.name !== "settings");
  const all = [...project, ...(await modeSettings(kernel))];
  return all.map((setting) => ({
    ...setting,
    current: setting.current === undefined ? undefined : kernel.secrets.redactJson(setting.current),
  }));
}

export function settingLines(settings: readonly Setting[]): string {
  return settings
    .flatMap((setting) => {
      const heading = `${setting.name}: ${setting.type}${setting.description === "" ? "" : ` (${setting.description})`}`;
      const current = setting.current === undefined ? "not set" : JSON.stringify(setting.current);
      return [heading, `  current: ${current}`];
    })
    .join("\n");
}
