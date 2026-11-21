import { itemNameWords, itemPlaceWords } from "./item-words.ts";
import type { Run } from "./runs/runs.ts";
import { shown } from "./trust.ts";

type Waiting = Extract<Run["state"], { readonly status: "waiting" }>["waiting"];

export type Approval = Extract<Waiting, { readonly reason: "approval" }>;

export type Card = NonNullable<Approval["card"]>;

export type CardLine = Card["lines"][number];

export type Choice = NonNullable<Approval["choices"]>[number];

type SkillUsed = Extract<CardLine, { readonly mark: "judged" }>["skills"][number];

export function wordsOf(text: string): readonly string[] {
  return shown(text).split(" ");
}

export function skillWords(skill: SkillUsed): string {
  return `${skill.mode} ${skill.skill}, tier ${skill.tier}`;
}

export function itemWords(line: CardLine): string {
  const { item } = line.source;
  const { foreach, itemName, itemCount } = line;
  if (item === undefined || foreach === undefined) {
    return "";
  }
  const named =
    itemName === undefined ? `${itemPlaceWords(item, itemCount)} of step ${foreach}` : itemNameWords(itemName);
  return `, for ${named}`;
}
