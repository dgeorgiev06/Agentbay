import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { bay, commandNames } from "./cli-fixture.ts";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

const globalOptions = " [--project <folder>] [--json]";

function tableRows(text: string): readonly string[] {
  const start = text.indexOf("## Commands\n");
  const lines = text.slice(start).split("\n");
  const table = lines.slice(lines.findIndex((line) => line.startsWith("|")));
  return table.slice(
    2,
    table.findIndex((line) => !line.startsWith("|")),
  );
}

async function rowOf(name: string): Promise<string> {
  const [usageLine = "", , summary = ""] = (await bay([name, "--help"])).output.split("\n");
  const usage = usageLine.replace(/^usage: /, "").replace(globalOptions, "");
  return `| \`${usage.replaceAll("|", "\\|")}\` | ${summary} |`;
}

test("the README's commands table lists exactly the commands bay --help lists, each with its own usage and summary", async () => {
  const names = await commandNames();
  assert.ok(names.length > 10, names.join(", "));
  const expected = await Promise.all(names.map(rowOf));
  assert.deepEqual(tableRows(readme), expected);
});
