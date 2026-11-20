import { fail, type ScriptContext } from "../../../../../bay/sdk.ts";
import { pinnedOf, type Pinned } from "./interface-pins.ts";

function parentAndName(path: string): { readonly parent: string; readonly name: string } {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? { parent: "", name: path } : { parent: path.slice(0, slash), name: path.slice(slash + 1) };
}

async function isListed(context: ScriptContext, folder: string, path: string): Promise<boolean> {
  const { parent, name } = parentAndName(path);
  const listed = await context.files.list(parent === "" ? folder : `${folder}/${parent}`);
  return listed.ok && listed.value.includes(name);
}

async function pinnedIn(context: ScriptContext, folder: string, path: string): Promise<Pinned> {
  const read = await context.files.read(`${folder}/${path}`);
  if (read.ok) {
    return pinnedOf(path, read.value);
  }
  if (await isListed(context, folder, path)) {
    return fail(`forge could not read the interface file ${path} in ${folder} to pin it: ${read.message}`);
  }
  return pinnedOf(path, undefined);
}

export function pinnedFiles(
  context: ScriptContext,
  folder: string,
  paths: readonly string[],
): Promise<readonly Pinned[]> {
  return Promise.all(paths.map((path) => pinnedIn(context, folder, path)));
}
