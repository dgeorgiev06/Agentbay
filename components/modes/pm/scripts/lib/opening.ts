import type { ScriptContext } from "../../../../../bay/sdk.ts";
import { startCard, type StartCard } from "./cards.ts";
import { settingsOf } from "./settings.ts";
import { readInterview } from "./store.ts";
import type { Interview } from "./interview.ts";

export type Opened = StartCard & { readonly before: Interview | undefined };

export async function openingOf(context: ScriptContext, job: string, words: string): Promise<Opened> {
  const settings = settingsOf(context.settings);
  const before = await readInterview(context, job);
  return { ...startCard({ job, words, perTurn: settings.perTurn, answers: settings.answers, before }), before };
}
