import type { Adapter, BuildRequest, SkillAgent } from "../../bay/adapter.ts";

export type Files = BuildRequest["files"];

export type Removal = BuildRequest["removal"];

export type Inspector = BuildRequest["inspector"];

export type DirectoryEntry = Awaited<ReturnType<Inspector["entries"]>>[number];

export type Tier = SkillAgent["tier"];

export type ListOutcome = Awaited<ReturnType<Adapter["build"]>>;

export type Problem = Extract<ListOutcome, { readonly ok: false }>["problems"][number];

export type Config = BuildRequest["system"]["config"];

export type TierSetting = NonNullable<NonNullable<Config["tiers"]>[Tier]>;
