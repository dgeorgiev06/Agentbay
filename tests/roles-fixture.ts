import assert from "node:assert/strict";
import { parse, stringify } from "yaml";
import type { SkillAgent } from "../bay/adapter.ts";
import { planAgents } from "../bay/build.ts";
import { isRecord } from "../bay/json.ts";
import type { Layout } from "../bay/layout.ts";
import { loadSystem } from "../bay/manifests/manifests.ts";
import { nodeFileSystem } from "../bay/node-ports.ts";
import type { FileSystem } from "../bay/ports.ts";
import { agentFileText } from "../adapters/claude-code/agent-file.ts";
import { stepsFileText } from "../adapters/claude-code/steps-file.ts";
import { tierSettings } from "../adapters/claude-code/tiers.ts";

const everyKitMode = ["forge", "feed-briefing", "typescript", "git-worktrees"];

export type Built = {
  readonly agents: readonly SkillAgent[];
  readonly files: Readonly<Record<string, string>>;
};

type StepRewrite = (step: Readonly<Record<string, unknown>>) => unknown;

function manifestRewritten(text: string, rewrite: StepRewrite): string {
  const manifest: unknown = parse(text);
  if (!isRecord(manifest) || !isRecord(manifest.actions)) {
    return text;
  }
  const rewritten = (step: unknown): unknown => (isRecord(step) ? rewrite(step) : step);
  const actions = Object.fromEntries(
    Object.entries(manifest.actions).map(([name, action]) => [
      name,
      isRecord(action) && Array.isArray(action.run) ? { ...action, run: action.run.map(rewritten) } : action,
    ]),
  );
  return stringify({ ...manifest, actions });
}

export function kitFiles(layout: Layout, rewrite?: StepRewrite): FileSystem {
  return {
    ...nodeFileSystem,
    readText: async (path) => {
      const text = await nodeFileSystem.readText(path);
      if (text !== undefined && path === layout.configFile) {
        const config: unknown = parse(text);
        return stringify({ ...(isRecord(config) ? config : {}), modes: everyKitMode });
      }
      const isManifest = text !== undefined && rewrite !== undefined && path.endsWith("/mode.yaml");
      return isManifest ? manifestRewritten(text, rewrite) : text;
    },
  };
}

export async function built(files: FileSystem, layout: Layout): Promise<Built> {
  const system = await loadSystem(files, layout);
  assert.ok(system.ok, system.ok ? "" : JSON.stringify(system.problems, null, 2));
  const planned = await planAgents(system.value);
  assert.ok(planned.ok, planned.ok ? "" : JSON.stringify(planned.problems, null, 2));
  const tiers = tierSettings(system.value.config, layout.configFile);
  assert.ok(tiers.ok);
  const agentFiles = planned.value.map((agent): [string, string] => [
    `.claude/agents/${agent.agent}.md`,
    agentFileText(agent, layout.project, tiers.settings[agent.tier]),
  ]);
  const steps: [string, string] = [".agentbay/steps.json", stepsFileText(layout, planned.value)];
  return { agents: planned.value, files: Object.fromEntries([...agentFiles, steps]) };
}
