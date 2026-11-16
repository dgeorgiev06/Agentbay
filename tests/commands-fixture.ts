import { readFileSync } from "node:fs";

export function isRunning(pid: number): boolean {
  try {
    const state = readFileSync(`/proc/${String(pid)}/stat`, "utf8").split(" ")[2];
    return state !== "Z" && state !== "X";
  } catch {
    return false;
  }
}
