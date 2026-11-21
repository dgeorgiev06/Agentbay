import type { Json } from "../../../../../bay/sdk.ts";

export type Answers = "lettered choices" | "free text";

export type Settings = {
  readonly perTurn: number;
  readonly answers: Answers;
};

const mostPerTurn = 12;

export function settingsOf(settings: Readonly<Record<string, Json>>): Settings {
  const perTurn = settings["questionsPerTurn"];
  return {
    perTurn: typeof perTurn === "number" ? perTurn : mostPerTurn,
    answers: settings["freeTextAnswers"] === true ? "free text" : "lettered choices",
  };
}
