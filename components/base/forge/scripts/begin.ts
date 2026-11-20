import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { wentAhead } from "./lib/go-ahead.ts";

export const run = defineScript((input, context) => wentAhead(context, fieldsOf(input)));
