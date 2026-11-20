import { defineScript } from "../../../../bay/sdk.ts";

const worktreesFolder = ".forge/worktrees";

export const run = defineScript(async (_input, context) => {
  const listed = await context.files.list(worktreesFolder);
  return { folders: listed.ok ? [...listed.value] : [] };
});
