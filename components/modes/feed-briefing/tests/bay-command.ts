import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Json } from "../../../../bay/sdk.ts";

export const kit = fileURLToPath(new URL("../../../..", import.meta.url));

export type Ran = { readonly status: number | null; readonly json: Json; readonly output: string };

export type Bay = {
  readonly ran: (argv: readonly string[]) => Ran;
  readonly succeeded: (argv: readonly string[]) => Json;
};

function jsonOf(value: unknown): Json {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item: unknown) => jsonOf(item));
  }
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]: [string, unknown]) => [key, jsonOf(item)]));
  }
  return null;
}

export function bayIn(project: string): Bay {
  const ran = (argv: readonly string[]): Ran => {
    const result = spawnSync(process.execPath, [join(kit, "bay", "cli.ts"), ...argv, "--json"], {
      cwd: project,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      input: "",
      encoding: "utf8",
    });
    const lines = result.stdout.split("\n").filter((line) => line !== "");
    assert.equal(lines.length, 1, `bay ${argv.join(" ")} printed:\n${result.stdout}\n${result.stderr}`);
    return { status: result.status, json: jsonOf(JSON.parse(lines[0] ?? "")), output: result.stdout };
  };
  const succeeded = (argv: readonly string[]): Json => {
    const answer = ran(argv);
    assert.equal(answer.status, 0, `bay ${argv.join(" ")}: ${answer.output}`);
    return answer.json;
  };
  return { ran, succeeded };
}
