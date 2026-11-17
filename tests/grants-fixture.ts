import type { Effect, GrantedCommand, ModeGrants } from "../bay/contracts.ts";

const noGrants: ModeGrants = {
  mode: "",
  modeFolder: "",
  databaseFile: "",
  migrationsFolder: "",
  readPaths: [],
  writePaths: [],
  throwawayPaths: [],
  secrets: [],
  hosts: [],
  commands: [],
  listTrust: { state: "not needed" },
};

const everyEffect: readonly Effect[] = ["read", "write", "network", "spend", "delete"];

export function grantsWith(fields: Partial<ModeGrants>): ModeGrants {
  return { ...noGrants, ...fields };
}

export function grantedCommand(name: string, run: string, effects: readonly Effect[] = everyEffect): GrantedCommand {
  return { name, words: run.split(" "), effects };
}
