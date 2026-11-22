import { fail, type ScriptContext } from "../../../../../bay/sdk.ts";

export const mostListed = 201;

async function namesIn(context: ScriptContext, path: string): Promise<readonly string[]> {
  const listed = await context.files.list(path);
  return listed.ok ? listed.value : fail(`forge could not list ${path}: ${listed.message}`);
}

export async function filesUnder(context: ScriptContext, root: string, folders: readonly string[]): Promise<string[]> {
  const files = new Set<string>();
  const toList = [...folders];
  while (toList.length > 0 && files.size < mostListed) {
    const folder = toList.shift() ?? "";
    for (const name of await namesIn(context, `${root}/${folder}`)) {
      const path = `${folder}/${name}`;
      const below = await namesIn(context, `${root}/${path}`);
      if (below.length > 0) {
        toList.push(path);
      } else {
        files.add(path);
      }
    }
  }
  return [...files].sort().slice(0, mostListed);
}
