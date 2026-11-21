import type { ScriptContext } from "../../../../../bay/sdk.ts";
import type { Source, Sources } from "./turn.ts";

async function sourceAt(context: ScriptContext, path: string): Promise<Source> {
  const read = await context.files.read(path);
  return read.ok ? { text: read.value } : { reason: read.message };
}

export async function readSources(context: ScriptContext, paths: readonly string[]): Promise<Sources> {
  const read = await Promise.all(paths.map(async (path) => [path, await sourceAt(context, path)] as const));
  return new Map(read);
}
