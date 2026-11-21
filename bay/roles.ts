import { tiers, type Tier } from "./contracts.ts";

export const roles = ["builder", "test writer", "reviewer", "planter", "designer", "challenger", "planner"] as const;

export type Role = (typeof roles)[number];

export type NamedTier = {
  readonly tier?: Tier;
  readonly role?: Role;
};

const roleTiers: Readonly<Record<Role, Tier>> = {
  builder: "balanced",
  "test writer": "balanced",
  reviewer: "deep",
  planter: "balanced",
  designer: "deep",
  challenger: "deep",
  planner: "balanced",
};

export function tierOfRole(role: Role): Tier {
  return roleTiers[role];
}

export function roleNamed(name: string | undefined): Role | undefined {
  return roles.find((role) => role === name);
}

export function tierOfStep(step: NamedTier): Tier {
  if (step.role !== undefined) {
    return tierOfRole(step.role);
  }
  if (step.tier !== undefined) {
    return step.tier;
  }
  throw new Error("A skill step names neither a role nor a tier; the kernel loads no such step.");
}

export function namingProblem(
  step: NamedTier,
  skill: string,
): { readonly said: string; readonly fix: string } | undefined {
  if (step.role !== undefined && step.tier !== undefined) {
    const { role, tier } = step;
    return {
      said:
        `names both the role ${role} and the tier ${tier} for the skill ${skill}; ` +
        `a role gives its step a tier, ${tierOfRole(role)} for the ${role}, so a step names one or the other.`,
      fix: `Keep role: ${role} and remove tier: ${tier}, or keep tier: ${tier} and remove role: ${role}.`,
    };
  }
  if (step.role === undefined && step.tier === undefined) {
    return {
      said:
        `names neither a role nor a tier for the skill ${skill}, ` +
        "so the kernel cannot say how capable a model its agent needs.",
      fix: `Add role: with one of ${roles.join(", ")}; or tier: with one of ${tiers.join(", ")}.`,
    };
  }
  return undefined;
}
