import { loadGrantedFolderRule, planAgents } from "./build.ts";
import { errors, type Finding } from "./check-context.ts";
import type { Layout } from "./layout.ts";
import type { System } from "./manifests/manifests.ts";
import type { FileInspector, FileSystem } from "./ports.ts";

export type LoadedForCheck = {
  readonly files: FileSystem;
  readonly inspector: FileInspector;
  readonly layout: Layout;
  readonly system: System;
};

export async function grantedFolderFindings(loaded: LoadedForCheck): Promise<readonly Finding[]> {
  const { files, inspector, layout, system } = loaded;
  const rule = await loadGrantedFolderRule(files, layout.kit, system.config.adapter);
  const agents = await planAgents(system);
  if (rule === undefined || !agents.ok) {
    return [];
  }
  return errors(await rule({ layout, agents: agents.value, files, inspector }));
}
