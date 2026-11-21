import { join } from "node:path/posix";
import { pathToFileURL } from "node:url";
import { agentName, type Adapter, type SkillAgent } from "./adapter.ts";
import type { Effect, Tier } from "./contracts.ts";
import type { FileSystem } from "./ports.ts";
import type { ActiveMode, System } from "./manifests/manifests.ts";
import { skillNameOf, skillToolsOf } from "./skill-tools.ts";
import { isRecord } from "./json.ts";
import type { Outcome, Problem } from "./outcome.ts";

type AgentUse = {
  readonly mode: ActiveMode;
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

function skillSteps(mode: ActiveMode): readonly SkillStepUse[] {
  return Object.values(mode.manifest.actions).flatMap((action) =>
    action.run.flatMap((step) =>
      "skill" in step ? [{ skill: step.skill, tier: step.tier, effects: action.effects }] : [],
    ),
  );
}

function agentUses(system: System): readonly AgentUse[] {
  const uses = new Map<string, AgentUse>();
  for (const [name, mode] of system.modes) {
    for (const step of skillSteps(mode)) {
      const key = `${name}/${skillNameOf(step.skill)}`;
      const use = uses.get(key) ?? { mode, skill: step.skill, tier: step.tier, effects: new Set() };
      use.tier = higherTier(use.tier, step.tier);
      for (const effect of step.effects) {
        use.effects.add(effect);
      }
      uses.set(key, use);
    }
  }
  return [...uses.values()];
}

async function agentOf(use: AgentUse): Promise<Outcome<SkillAgent>> {
  const found = await use.mode.skill(use.skill);
  if (!found.ok) {
    return found;
  }
  const mode = use.mode.manifest.name;
  const skill = skillNameOf(use.skill);
  const agent: SkillAgent = {
    agent: agentName(mode, skill),
    mode,
    skill,
    skillFile: found.value.file,
    description: found.value.frontMatter.description,
    tier: use.tier,
    kernelTools: skillToolsOf(found.value.tools).kernelTools,
    grants: use.mode.grants,
    effects: [...use.effects],
  };
  return { ok: true, value: agent };
}

export async function planAgents(system: System): Promise<Outcome<readonly SkillAgent[]>> {
  const agents: SkillAgent[] = [];
  const problems: Problem[] = [];
  for (const use of agentUses(system)) {
    const outcome = await agentOf(use);
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
