import { join } from "node:path/posix";
import { pathToFileURL } from "node:url";
import { agentName, type Adapter, type SkillAgent } from "./adapter.ts";
import type { Effect, PolicyOf, Tier } from "./contracts.ts";
import type { FileSystem } from "./ports.ts";
import type { LoadedMode, System } from "./registry.ts";
import { skillNameOf, skillToolsOf } from "./skill-tools.ts";
import { isRecord, parseSkill, type Outcome, type Problem } from "./spec.ts";

export type AgentPlanning = {
  readonly system: System;
  readonly policyOf: PolicyOf;
  readonly files: FileSystem;
};

type SkillUse = {
  readonly mode: string;
  readonly folder: string;
  readonly skill: string;
  tier: Tier;
  readonly effects: Set<Effect>;
};

type SkillStepUse = {
  readonly skill: string;
  readonly tier: Tier;
  readonly effects: readonly Effect[];
};

const tierOrder: readonly Tier[] = ["fast", "balanced", "deep"];

const adapterNamePattern = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

function higherTier(first: Tier, second: Tier): Tier {
  return tierOrder.indexOf(second) > tierOrder.indexOf(first) ? second : first;
}

function skillSteps(mode: LoadedMode): readonly SkillStepUse[] {
  return Object.values(mode.manifest.actions).flatMap((action) =>
    action.run.flatMap((step) =>
      "skill" in step ? [{ skill: step.skill, tier: step.tier, effects: action.effects }] : [],
    ),
  );
}

function skillUses(system: System): readonly SkillUse[] {
  const uses = new Map<string, SkillUse>();
  for (const [mode, loaded] of system.modes) {
    if (!system.active.has(mode)) {
      continue;
    }
    for (const step of skillSteps(loaded)) {
      const key = `${mode}/${skillNameOf(step.skill)}`;
      const use = uses.get(key) ?? {
        mode,
        folder: loaded.folder,
        skill: step.skill,
        tier: step.tier,
        effects: new Set(),
      };
      use.tier = higherTier(use.tier, step.tier);
      for (const effect of step.effects) {
        use.effects.add(effect);
      }
      uses.set(key, use);
    }
  }
  return [...uses.values()];
}

async function agentOf(planning: AgentPlanning, use: SkillUse): Promise<Outcome<SkillAgent>> {
  const skillFile = join(use.folder, use.skill, "SKILL.md");
  const parsed = await parseSkill(planning.files, skillFile);
  if (!parsed.ok) {
    return parsed;
  }
  const tools = await skillToolsOf(planning.files, skillFile);
  const skill = skillNameOf(use.skill);
  const agent: SkillAgent = {
    agent: agentName(use.mode, skill),
    mode: use.mode,
    skill,
    skillFile,
    description: parsed.value.frontMatter.description,
    tier: use.tier,
    kernelTools: tools.kernelTools,
    grants: planning.policyOf(use.mode),
    effects: [...use.effects],
  };
  return { ok: true, value: agent };
}

export async function planAgents(planning: AgentPlanning): Promise<Outcome<readonly SkillAgent[]>> {
  const agents: SkillAgent[] = [];
  const problems: Problem[] = [];
  for (const use of skillUses(planning.system)) {
    const outcome = await agentOf(planning, use);
    if (outcome.ok) {
      agents.push(outcome.value);
    } else {
      problems.push(...outcome.problems);
    }
  }
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, value: agents.sort((first, second) => first.agent.localeCompare(second.agent)) };
}

function isAdapter(value: unknown): value is Adapter {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    typeof value.build === "function" &&
    typeof value.clean === "function"
  );
}

function adapterProblem(file: string, message: string, fix: string): Outcome<Adapter> {
  return { ok: false, problems: [{ file, path: "", message, fix }] };
}

export async function loadAdapter(files: FileSystem, kit: string, name: string): Promise<Outcome<Adapter>> {
  if (!adapterNamePattern.test(name)) {
    return adapterProblem("", `The adapter name ${name} is not kebab-case.`, "Name an adapter folder under adapters/.");
  }
  const file = join(kit, "adapters", name, "adapter.ts");
  if (!(await files.exists(file))) {
    return adapterProblem(file, `There is no adapter ${name}: ${file} does not exist.`, "Name an adapter of the kit.");
  }
  const loaded: unknown = await import(pathToFileURL(file).href);
  const adapter = isRecord(loaded) ? loaded.adapter : undefined;
  if (!isAdapter(adapter)) {
    return adapterProblem(
      file,
      `${file} does not export an adapter value with a name and the functions build and clean.`,
      "Export const adapter: Adapter from it.",
    );
  }
  return { ok: true, value: adapter };
}
