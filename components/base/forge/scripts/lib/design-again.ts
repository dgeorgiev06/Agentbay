import type { Chosen } from "./challenge-answer.ts";
import type { DesignPath, Stance } from "./path-card.ts";

export function answeringStance(path: DesignPath, chosen: Chosen): Stance {
  return path === "full" && chosen === "second" ? "second" : "first";
}
