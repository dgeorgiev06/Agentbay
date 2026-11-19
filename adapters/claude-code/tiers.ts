import type { Config, Problem, Tier, TierSetting } from "./adapter-types.ts";

export type TierSettings = Readonly<Record<Tier, TierSetting>>;

export type TierReading =
  | { readonly ok: true; readonly settings: TierSettings }
  | { readonly ok: false; readonly problems: readonly Problem[] };

const knownModels: readonly string[] = ["haiku", "sonnet", "opus", "fable"];

const defaultTiers: TierSettings = {
  fast: { model: "haiku" },
  balanced: { model: "sonnet" },
  deep: { model: "opus" },
};

function inWords(names: readonly string[]): string {
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

function unknownModel(configFile: string, tier: string, model: string): Problem {
  return {
    file: configFile,
    path: `/tiers/${tier}/model`,
    message:
      `The tier ${tier} names the model ${model}, which the claude-code adapter does not know. ` +
      `It knows ${inWords(knownModels)}.`,
    fix: `Name one of those models as tiers.${tier}.model, then run bay build.`,
  };
}

export function tierSettings(config: Config, configFile: string): TierReading {
  const named = Object.entries(config.tiers ?? {});
  const problems = named.flatMap(([tier, setting]) =>
    knownModels.includes(setting.model) ? [] : [unknownModel(configFile, tier, setting.model)],
  );
  if (problems.length > 0) {
    return { ok: false, problems };
  }
  return { ok: true, settings: { ...defaultTiers, ...config.tiers } };
}
