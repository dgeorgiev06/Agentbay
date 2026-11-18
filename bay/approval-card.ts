import type { Run } from "./runs/runs.ts";
import { shown } from "./trust.ts";
import { hanging, hashLine, namedRows } from "./trust-card.ts";

type Waiting = Extract<Run["state"], { readonly status: "waiting" }>["waiting"];

type Approval = Extract<Waiting, { readonly reason: "approval" }>;

type Card = NonNullable<Approval["card"]>;

type CardLine = Card["lines"][number];

type SkillUsed = Extract<CardLine, { readonly mark: "judged" }>["skills"][number];

type Choice = NonNullable<Approval["choices"]>[number];

const markColumn = "computed".length + 1;

const continued = "  ";

function wordsOf(text: string): readonly string[] {
  return shown(text).split(" ");
}

function marked(mark: CardLine["mark"], words: string, indent: string): readonly string[] {
  const lead = `${mark.padEnd(markColumn)}${indent}`;
  return hanging(wordsOf(words), { first: lead, rest: `${lead}${continued}` });
}

function skillWords(skill: SkillUsed): string {
  return `${skill.mode} ${skill.skill}, tier ${skill.tier}`;
}

function judgedBy(skills: readonly SkillUsed[]): readonly string[] {
  if (skills.length === 0) {
    return [];
  }
  return marked("judged", `by ${skills.map(skillWords).join("; ")}`, " ");
}

function endsJudgedStep(line: CardLine, next: CardLine | undefined): boolean {
  return next?.mark !== "judged" || next.source.step !== line.source.step;
}

function lineRows(lines: readonly CardLine[]): readonly string[] {
  return lines.flatMap((line, index) => {
    const rows = marked(line.mark, line.words, "");
    if (line.mark !== "judged" || !endsJudgedStep(line, lines[index + 1])) {
      return rows;
    }
    return [...rows, ...judgedBy(line.skills)];
  });
}

function choiceSegments(choice: Choice): readonly { readonly label: string; readonly tokens: readonly string[] }[] {
  const named = { label: shown(choice.name), tokens: wordsOf(choice.does) };
  switch (choice.status) {
    case "offered":
      return [named];
    case "withheld":
      return [named, { label: "", tokens: ["not", "offered:", ...wordsOf(choice.reason)] }];
  }
}

function choiceRows(choices: readonly Choice[] | undefined): readonly string[] {
  return choices === undefined ? [] : ["Choose one:", ...namedRows(choices.map(choiceSegments))];
}

function countedLine(counted: Card["counted"]): string {
  return `checked: ${String(counted.ran)} ran, ${String(counted.computed)} computed, ${String(counted.judged)} judged`;
}

function cardRows(approval: Approval, card: Card): readonly string[] {
  return [
    ...hanging(wordsOf(card.title), { first: "", rest: "" }),
    ...lineRows(card.lines),
    ...choiceRows(approval.choices),
    countedLine(card.counted),
    hashLine(approval.hash),
  ];
}

export function approvalLines(approval: Approval): readonly string[] {
  const { card } = approval;
  if (card !== undefined) {
    return cardRows(approval, card);
  }
  return [
    `approval: ${approval.question}`,
    `shown content (hash ${approval.hash}):`,
    JSON.stringify(approval.content, null, 2),
    ...choiceRows(approval.choices),
  ];
}
