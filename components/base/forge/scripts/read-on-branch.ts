import { defineScript, fieldsOf } from "../../../../bay/sdk.ts";
import { branchesSaid } from "./lib/branch-endings.ts";
import { cutAfresh, intoOf, removedThenDropped } from "./lib/drops.ts";
import { textOf, textsOf } from "./lib/json-values.ts";
import { filesUnder } from "./lib/listing.ts";

export const run = defineScript(async (input, context) => {
  const fields = fieldsOf(input);
  const into = intoOf(context);
  const cut = await cutAfresh(context, { slice: textOf(fields.cutAs), base: textOf(fields.base) }, into);
  const files = await Promise.all(
    textsOf(fields.paths).map(async (path) => {
      const read = await context.files.read(`${cut.folder}/${path}`);
      return read.ok ? { path, text: read.value } : { path };
    }),
  );
  const folders = textsOf(fields.list);
  const listed = folders.length === 0 ? {} : { listed: await filesUnder(context, cut.folder, folders) };
  const drops = await removedThenDropped(context, cut, into);
  return { commit: cut.commit, files, ...listed, ...branchesSaid([], drops.stayed) };
});
