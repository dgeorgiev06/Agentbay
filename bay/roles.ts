import { tiers, type Tier } from "./contracts.ts";

export const roles = ["builder", "test writer", "reviewer", "planter", "designer", "challenger", "planner"] as const;

export type Role = (typeof roles)[number];

export type NamedTier = {
  readonly tier: Tier;
  readonly role?: Role;
};

type WrittenNames = {
  readonly tier?: Tier;
  readonly role?: string;
};

export type Naming =
  | { readonly ok: true; readonly named: NamedTier }
  | { readonly ok: false; readonly field: "role" | "step"; readonly said: string; readonly fix: string };

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

export function roleField(role: Role | undefined): { readonly role?: Role } {
  return role === undefined ? {} : { role };
}

function meantRole(written: string): Role | undefined {
  return roleNamed(written.trim().toLowerCase().replace(/\s+/g, " "));
}

function unknownRole(written: string, skill: string): Naming {
  const meant = meantRole(written);
  if (meant !== undefined) {
    return {
      ok: false,
      field: "role",
      said: `names the role "${written}" for the skill ${skill}, and the kit has no role written that way.`,
      fix: `Write it in lower case, with one space between words: role: ${meant}.`,
    };
  }
  return {
    ok: false,
    field: "role",
    said: `names the role "${written}" for the skill ${skill}, which is not one of the kit's roles: ${roles.join(", ")}.`,
    fix: `Name one of those roles, or name a tier in its place: ${tiers.join(", ")}.`,
  };
}

function bothNamed(role: Role, tier: Tier, skill: string): Naming {
  return {
    ok: false,
    field: "step",
    said:
      `names both the role ${role} and the tier ${tier} for the skill ${skill}; ` +
      `a role gives its step a tier, ${tierOfRole(role)} for the ${role}, so a step names one or the other.`,
    fix: `Keep role: ${role} and remove tier: ${tier}, or keep tier: ${tier} and remove role: ${role}.`,
  };
}

function neitherNamed(skill: string): Naming {
  return {
    ok: false,
    field: "step",
    said:
      `names neither a role nor a tier for the skill ${skill}, ` +
      "so the kernel cannot say how capable a model its agent needs.",
    fix: `Add role: with one of ${roles.join(", ")}; or tier: with one of ${tiers.join(", ")}.`,
  };
}

export function namingOf(written: WrittenNames, skill: string): Naming {
  if (written.role === undefined) {
    return written.tier === undefined ? neitherNamed(skill) : { ok: true, named: { tier: written.tier } };
  }
  const role = roleNamed(written.role);
  if (role === undefined) {
    return unknownRole(written.role, skill);
  }
  if (written.tier !== undefined) {
    return bothNamed(role, written.tier, skill);
  }
  return { ok: true, named: { tier: tierOfRole(role), role } };
}
