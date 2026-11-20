import { foundAt, refusedToFind } from "./lib/find.ts";
import { branchHead } from "./lib/git.ts";
import { defineRequestScript } from "./lib/request.ts";

export const run = defineRequestScript(async (request, context) => {
  const branch = request.text("branch");
  return refusedToFind(branch) ?? foundAt(branch, await branchHead(context, branch));
});
