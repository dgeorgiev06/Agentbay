import { loadGrantedFolderRule, planAgents } from "./build.ts";
import { errors, type Finding } from "./check-context.ts";
import type { Layout } from "./layout.ts";
import { loadSystem } from "./manifests/manifests.ts";
import type { FileSystem } from "./ports.ts";

export async function grantedFolderFindings(files: FileSystem, layout: Layout): Promise<readonly Finding[]> {
  const system = await loadSystem(files, layout);
  if (!system.ok) {
    return [];
  }
  const rule = await loadGrantedFolderRule(files, layout.kit, system.value.config.adapter);
  const agents = await planAgents(system.value);
  if (rule === undefined || !agents.ok) {
    return [];
  }
  return errors(await rule({ layout, agents: agents.value, files }));
}
