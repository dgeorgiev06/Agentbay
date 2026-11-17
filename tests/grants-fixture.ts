import type { ModeGrants } from "../bay/contracts.ts";

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
};

export function grantsWith(fields: Partial<ModeGrants>): ModeGrants {
  return { ...noGrants, ...fields };
}
