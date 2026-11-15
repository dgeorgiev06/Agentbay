import { defineScript } from "../../../../bay/sdk.ts";
import { nativeFields, sourceKinds, sourceName } from "./lib/feed.ts";

export const run = defineScript(() => Promise.resolve({ source: sourceName, kinds: sourceKinds, nativeFields }));
