import { join } from "node:path";
import type { CleanRequest } from "../../bay/adapter.ts";
import type { ListOutcome } from "./adapter-types.ts";
import { readRecord, recordPath, sha256, unreadableRecord, type CreatedFile, type MergedFile } from "./build-record.ts";
import { canRemove, removalProblem, type RemovableFiles } from "./file-removal.ts";
import { restoredText } from "./merged-files.ts";

async function cleanCreated(files: RemovableFiles, root: string, entry: CreatedFile): Promise<string> {
  const path = join(root, entry.path);
  const current = await files.readText(path);
  if (current === undefined) {
    return `${entry.path}: already gone`;
  }
  if (sha256(current) !== entry.sha256) {
    return `${entry.path}: changed since the build, left in place`;
  }
  await files.remove(path);
  return `${entry.path}: deleted`;
}

async function cleanMerged(files: RemovableFiles, root: string, entry: MergedFile): Promise<string> {
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
    await files.remove(path);
    return `${entry.path}: deleted; it held only what agentbay added`;
  }
  await files.writeAtomic(path, restored.text);
  return `${entry.path}: ${restored.exact ? "restored as it was before the build" : "agentbay's part removed, later edits kept"}`;
}

export async function clean(request: CleanRequest): Promise<ListOutcome> {
  const { files, root } = request;
  const reading = readRecord(await files.readText(join(root, recordPath)));
  switch (reading.kind) {
    case "none":
      return { ok: true, value: [`${recordPath}: no build record, so there is nothing to clean`] };
    case "unreadable":
      return { ok: false, problems: [unreadableRecord] };
    case "record":
      break;
  }
  if (!canRemove(files)) {
    return { ok: false, problems: [removalProblem(recordPath)] };
  }
  const report: string[] = [];
  for (const entry of reading.record.created) {
    report.push(await cleanCreated(files, root, entry));
  }
  for (const entry of reading.record.merged) {
    report.push(await cleanMerged(files, root, entry));
  }
  await files.remove(join(root, recordPath));
  return { ok: true, value: [...report, `${recordPath}: deleted`] };
}
