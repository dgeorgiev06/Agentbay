import { basename, normalize } from "node:path/posix";
import { entriesOf, splitSections } from "./check-skills.ts";
import type { FileSystem } from "./ports.ts";

const toolNames = ["db_query", "files_read", "files_list", "files_write", "call_action", "submit"] as const;

export type ToolName = (typeof toolNames)[number];

export type SkillTools = {
  readonly kernelTools: readonly ToolName[];
  readonly actions: readonly string[];
};

const brokerResources: readonly string[] = ["db", "files", "secrets", "http", "events"];

const toolsOfResource: ReadonlyMap<string, readonly ToolName[]> = new Map([
  ["db", ["db_query"]],
  ["files", ["files_read", "files_list", "files_write"]],
]);

export function isToolName(name: string): name is ToolName {
  return toolNames.some((tool) => tool === name);
}

function skillToolsOfText(text: string): SkillTools {
  const entries = entriesOf(splitSections(text), "Tools").map((item) => item.entry);
  const actions = entries.filter((entry) => !brokerResources.includes(entry));
  const fromResources = entries.flatMap((entry) => toolsOfResource.get(entry) ?? []);
  const fromActions: readonly ToolName[] = actions.length > 0 ? ["call_action"] : [];
  const named = new Set<ToolName>([...fromResources, ...fromActions, "submit"]);
  return { kernelTools: toolNames.filter((tool) => named.has(tool)), actions };
}

export async function skillToolsOf(files: FileSystem, skillFile: string): Promise<SkillTools> {
  const text = await files.readText(skillFile);
  return skillToolsOfText(text ?? "");
}

export function skillNameOf(skillPath: string): string {
  return basename(normalize(skillPath));
}
