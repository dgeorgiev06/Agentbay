import { defineScript } from "../../../../bay/sdk.ts";
import { openPartition } from "./lib/partition.ts";
import { putItems } from "./lib/put.ts";

export const run = defineScript(async (input, context) => putItems(await openPartition(context), input, new Date()));
