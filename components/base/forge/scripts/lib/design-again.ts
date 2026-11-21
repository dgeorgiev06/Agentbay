import type { JsonFields } from "../../../../../bay/sdk.ts";
import type { Challenge, Chosen } from "./challenge-answer.ts";
import type { DesignPath, Stance } from "./path-card.ts";
import { notHeldIds } from "./practice-answers.ts";

export function secondPassNeeded(challenge: Challenge): boolean {
  return notHeldIds(challenge.practices).length > 0 || challenge.findings.length > 0;
}

export function answeringStance(path: DesignPath, chosen: Chosen): Stance {
  return path === "full" && chosen === "second" ? "second" : "first";
}

export function foundOf(challenge: Challenge): JsonFields {
  return {
    practices: challenge.practices.filter((practice) => practice.answer === "not-held").map((each) => ({ ...each })),
    findings: challenge.findings.map((finding) => ({ ...finding })),
  };
}
