import { basename, dirname, join } from "node:path/posix";

const exampleEnding = ".example.json";

export const exampleFilePattern = `tests/<action>${exampleEnding}`;

export function exampleFile(modeFolder: string, action: string): string {
  return join(modeFolder, "tests", `${action}${exampleEnding}`);
}

export function isExampleFile(file: string): boolean {
  return basename(dirname(file)) === "tests" && basename(file).endsWith(exampleEnding);
}
