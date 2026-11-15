import type { Adapter } from "../../bay/adapter.ts";
import { build } from "./build.ts";
import { clean } from "./clean.ts";

export const adapter: Adapter = { name: "claude-code", build, clean };
