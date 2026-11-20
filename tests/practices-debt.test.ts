import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { fieldOf, textField, toJson } from "../bay/json.ts";

type Debt = {
  readonly id: string;
  readonly file: string;
};

const practicesFiles = ["framework/practices.md", "components/base/typescript/practices.md"];

const debtFile = "framework/practices-debt.yaml";

const writeDebtVariable = "PRACTICES_DEBT";

const mostDebts = 9;

function keyOf(debt: Debt): string {
  return `${debt.id} in ${debt.file}`;
}

const tableRow = /^\|\s*([A-Z]{1,4}-\d{1,3})\s*\|.*\|\s*([^|]*?)\s*\|\s*$/;

const heading = /^##\s+([A-Z]{1,4}-\d{1,3})\s/;

const plannedHolder = /\b(planned check|check planned)\b/i;

function holdersOf(text: string): readonly (readonly [string, string])[] {
  const lines = text.split("\n");
  return lines.flatMap((line, at) => {
    const row = tableRow.exec(line);
    if (row !== null) {
      return [[row[1] ?? "", row[2] ?? ""] as const];
    }
    const headed = heading.exec(line);
    const heldBy = lines.slice(at + 1, at + 4).find((next) => next.startsWith("Held by:"));
    return headed === null || heldBy === undefined
      ? []
      : [[headed[1] ?? "", heldBy.split(" Source:")[0] ?? ""] as const];
  });
}

function plannedIn(text: string, file: string): readonly Debt[] {
  const holders = holdersOf(text);
  return holders.filter(([, holder]) => plannedHolder.test(holder)).map(([id]) => ({ id, file }));
}

function listedIn(text: string): readonly Debt[] {
  const entries = fieldOf(toJson(parse(text)), "planned");
  const listed = Array.isArray(entries) ? entries : [];
  return listed.flatMap((entry: unknown) => {
    const id = textField(toJson(entry), "id");
    const file = textField(toJson(entry), "file");
    return id === undefined || file === undefined ? [] : [{ id, file }];
  });
}

function missingFrom(debts: readonly Debt[], others: readonly Debt[]): readonly string[] {
  const otherKeys = others.map(keyOf);
  return debts.map(keyOf).filter((key) => !otherKeys.includes(key));
}

test("a row or a heading whose holder names a planned check is a debt, and one held otherwise is not", () => {
  const text = [
    "| Id | Practice | Held by |",
    "|---|---|---|",
    "| P-12 | One place. | planned check: copy-paste detector |",
    "| P-36 | Named for what it does. | check planned: names; review |",
    "| P-03 | Problems are values. | review |",
    "## TS-05 A problem is a value",
    "",
    "Held by: review; planned check: a lint rule. Source: ours.",
    "## TS-06 Index access may be missing",
    "",
    "Held by: compiler. Source: official; a check planned in prose is not the holder.",
  ].join("\n");
  assert.deepEqual(
    plannedIn(text, "a.md").map((debt) => debt.id),
    ["P-12", "P-36", "TS-05"],
  );
});

test("the debt list is read back as the practices it lists, and an entry without an id or a file is dropped", () => {
  const text = stringify({ planned: [{ id: "P-12", file: "framework/practices.md" }, { id: "P-15" }] });
  assert.deepEqual(listedIn(text), [{ id: "P-12", file: "framework/practices.md" }]);
  assert.deepEqual(
    missingFrom(
      [
        { id: "P-12", file: "a.md" },
        { id: "P-15", file: "a.md" },
      ],
      [{ id: "P-12", file: "a.md" }],
    ),
    ["P-15 in a.md"],
  );
});

test("every practice whose holder is a planned check is in the debt list, the list names no other, and it only shrinks", () => {
  const found = practicesFiles.flatMap((file) => plannedIn(readFileSync(file, "utf8"), file));
  if (process.env[writeDebtVariable] === "write") {
    writeFileSync(debtFile, stringify({ planned: found }));
  }
  const listed = listedIn(readFileSync(debtFile, "utf8"));
  assert.deepEqual(
    missingFrom(found, listed),
    [],
    `These practices are held by a planned check and are not in ${debtFile}; build the check, or list them.`,
  );
  assert.deepEqual(
    missingFrom(listed, found),
    [],
    `These entries of ${debtFile} are no longer held by a planned check: delete them.`,
  );
  assert.ok(
    listed.length <= mostDebts,
    `${debtFile} lists ${String(listed.length)} practices; it may list at most ${String(mostDebts)}, and lower this ` +
      "number when one is paid.",
  );
});
