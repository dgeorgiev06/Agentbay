import type { Adapter, BuildRequest, SkillAgent } from "../../bay/adapter.ts";

export type Files = BuildRequest["files"];

export type Removal = BuildRequest["removal"];

export type Tier = SkillAgent["tier"];

export type ListOutcome = Awaited<ReturnType<Adapter["build"]>>;

export type Problem = Extract<ListOutcome, { readonly ok: false }>["problems"][number];
