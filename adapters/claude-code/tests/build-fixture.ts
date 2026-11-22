import type { BuildRequest, Layout, SkillAgent } from "../../../bay/adapter.ts";
import { fakeFileSystem, fakeInspector } from "../../../tests/fakes.ts";
import { grantsWith } from "../../../tests/grants-fixture.ts";
import type { Files, Inspector, Removal } from "../adapter-types.ts";

export type FilesWithRemoval = Files & { readonly removal: Removal; readonly inspector: Inspector };

export type MemoryFiles = FilesWithRemoval & { readonly snapshot: () => Readonly<Record<string, string>> };

export function memoryFiles(initial: Readonly<Record<string, string>> = {}): MemoryFiles {
  const files = fakeFileSystem(initial);
  return {
    ...files,
    inspector: fakeInspector(files.contents),
    snapshot: () => Object.fromEntries([...files.contents].sort(([left], [right]) => left.localeCompare(right))),
  };
}

export const project = "/proj";

export const kit = "/kit";

export const layout: Layout = { kit, project, configFile: `${project}/agentbay.config.yaml` };

const everyEffect: SkillAgent["effects"] = ["read", "write", "network", "spend", "delete"];

type AgentShape = {
  readonly mode: string;
  readonly skill: string;
  readonly tier: SkillAgent["tier"];
  readonly kernelTools: readonly string[];
  readonly read: readonly string[];
  readonly effects?: SkillAgent["effects"];
  readonly write: readonly string[];
  readonly commands: readonly string[];
};

export function skillAgent(shape: AgentShape): SkillAgent {
  const modeFolder = `${kit}/components/modes/${shape.mode}`;
  return {
    agent: `agentbay-${shape.mode}-${shape.skill}`,
    mode: shape.mode,
    skill: shape.skill,
    skillFile: `${modeFolder}/skills/${shape.skill}/SKILL.md`,
    description: `Writes the ${shape.skill}\nfor the "${shape.mode}" mode: briefly.`,
    tier: shape.tier,
    kernelTools: shape.kernelTools,
    grants: grantsWith({
      mode: shape.mode,
      modeFolder,
      databaseFile: `${project}/.agentbay/data/${shape.mode}.db`,
      migrationsFolder: `${modeFolder}/migrations`,
      readPaths: shape.read,
      writePaths: shape.write,
      commands: shape.commands.map((run, index) => ({
        name: `command-${String(index + 1)}`,
        words: run.split(" "),
        effects: everyEffect,
      })),
    }),
    effects: shape.effects ?? (shape.write.length > 0 ? ["read", "write"] : ["read"]),
  };
}

export const digestAgent = skillAgent({
  mode: "mail-briefing",
  skill: "digest",
  tier: "balanced",
  kernelTools: ["db_query"],
  read: [`${kit}/components/modes/mail-briefing`, `${project}/notes`, `${project}/out/digests`],
  write: [`${project}/out/digests`],
  commands: [],
});

export const scanAgent = skillAgent({
  mode: "store",
  skill: "scan",
  tier: "fast",
  kernelTools: ["submit", "files_read"],
  read: [`${kit}/components/modes/store`],
  write: [],
  commands: [],
});

export const buildAgent = skillAgent({
  mode: "forge",
  skill: "build",
  tier: "deep",
  kernelTools: [],
  read: [`${kit}/components/modes/forge`, `${project}/work`],
  write: [`${project}/work`],
  effects: ["read", "write", "network", "spend", "delete"],
  commands: ["node --test", "git status"],
});

export const allAgents = [digestAgent, scanAgent, buildAgent];

export function buildRequest(files: FilesWithRemoval, agents: readonly SkillAgent[] = allAgents): BuildRequest {
  const system: BuildRequest["system"] = {
    modes: new Map(),
    inactive: new Set<string>(),
    interfaces: new Map(),
    config: { bindings: {}, adapter: "claude-code" },
    action: () => ({ ok: false, problems: [] }),
    workflow: () => ({ ok: false, problems: [] }),
    listing: () => ({ ok: false, problems: [] }),
  };
  return { system, layout, agents, files, inspector: files.inspector, removal: files.removal };
}

export const userSettings =
  '{"model":   "opus",\n "hooks": {"PreToolUse": [{"matcher": "Bash", "hooks": [{"type": "command", "command": "mine"}]}],' +
  ' "Stop": []},\n "permissions": {"allow": ["Bash(ls:*)"], "deny": ["Read(./secrets/**)"]}}';

export const userMcp = '{\n\t"mcpServers": { "mine": { "command": "x", "args": [] } },\n\t"other": 1\n}\n';

export const userClaude = "# mine\n\nKeep this.";

export const existingProject: Readonly<Record<string, string>> = {
  [`${project}/.claude/settings.json`]: userSettings,
  [`${project}/.mcp.json`]: userMcp,
  [`${project}/CLAUDE.md`]: userClaude,
  [`${project}/src/app.ts`]: "export {};\n",
};
