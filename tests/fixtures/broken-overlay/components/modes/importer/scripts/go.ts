import { defineScript } from "agentbay/sdk";
import { other } from "../../writer/scripts/finish.ts";
import { parse } from "yaml";
import "/etc/hosts";

const name = "x";
void import(name);
void other;
void parse;

export const run = defineScript(async (input) => input);
