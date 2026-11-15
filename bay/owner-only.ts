import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from "node:fs";
import { dirname } from "node:path";

const ownerOnlyFolderMode = 0o700;

const ownerOnlyFileMode = 0o600;

const sideFileSuffixes = ["-wal", "-shm"] as const;

function hasFileModes(platform: string): boolean {
  return platform !== "win32";
}

export function createOwnerOnlyFile(file: string, platform: string = process.platform): void {
  const folder = dirname(file);
  mkdirSync(folder, { recursive: true, mode: ownerOnlyFolderMode });
  closeSync(openSync(file, "a", ownerOnlyFileMode));
  if (hasFileModes(platform)) {
    chmodSync(folder, ownerOnlyFolderMode);
    chmodSync(file, ownerOnlyFileMode);
  }
}

export function narrowSideFiles(file: string, platform: string = process.platform): void {
  if (!hasFileModes(platform)) {
    return;
  }
  for (const suffix of sideFileSuffixes) {
    const sideFile = `${file}${suffix}`;
    if (existsSync(sideFile)) {
      chmodSync(sideFile, ownerOnlyFileMode);
    }
  }
}
