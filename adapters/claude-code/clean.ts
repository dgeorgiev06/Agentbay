import { join } from "node:path";
import type { CleanRequest } from "../../bay/adapter.ts";
import type { ListOutcome } from "./adapter-types.ts";
import { readRecord, recordPath, sha256, unreadableRecord, type CreatedFile, type MergedFile } from "./build-record.ts";
import type { Files, Removal } from "./adapter-types.ts";
import { restoredText } from "./merged-files.ts";

type Effects = { readonly files: Files; readonly removal: Removal; readonly root: string };

async function cleanCreated({ files, removal, root }: Effects, entry: CreatedFile): Promise<string> {
  const path = join(root, entry.path);
  const current = await files.readText(path);
  if (current === undefined) {
    return `${entry.path}: already gone`;
  }
  if (sha256(current) !== entry.sha256) {
    return `${entry.path}: changed since the build, left in place`;
  }
  await removal.remove(path);
  return `${entry.path}: deleted`;
}

async function cleanMerged({ files, removal, root }: Effects, entry: MergedFile): Promise<string> {
  const path = join(root, entry.path);
  const current = await files.readText(path);
  if (current === undefined) {
    return `${entry.path}: already gone`;
  }
  const restored = restoredText(current, entry);
  if (restored.kind === "changed") {
    return `${entry.path}: the part agentbay added was changed since the build, left in place`;
  }
  if (restored.text === undefined) {
    await removal.remove(path);
    return `${entry.path}: deleted; it held only what agentbay added`;
  }
  await files.writeAtomic(path, restored.text);
  return `${entry.path}: ${restored.exact ? "restored as it was before the build" : "agentbay's part removed, later edits kept"}`;
}

async function cleanFolder({ files, removal, root }: Effects, folder: string): Promise<string> {
  await removal.remove(join(root, folder));
  return (await files.exists(join(root, folder)))
    ? `${folder}/: kept; it still holds files`
    : `${folder}/: deleted; the build had created it`;
}

export async function clean(request: CleanRequest): Promise<ListOutcome> {
  const reading = readRecord(await request.files.readText(join(request.root, recordPath)));
  switch (reading.kind) {
    case "none":
      return { ok: true, value: [`${recordPath}: no build record, so there is nothing to clean`] };
    case "unreadable":
      return { ok: false, problems: [unreadableRecord] };
    case "record":
      break;
  }
  const effects: Effects = request;
  const report: string[] = [];
  for (const entry of reading.record.created) {
    report.push(await cleanCreated(effects, entry));
  }
  for (const entry of reading.record.merged) {
    report.push(await cleanMerged(effects, entry));
  }
  await request.removal.remove(join(request.root, recordPath));
  report.push(`${recordPath}: deleted`);
  for (const folder of reading.record.createdFolders) {
    report.push(await cleanFolder(effects, folder));
  }
  return { ok: true, value: report };
}
