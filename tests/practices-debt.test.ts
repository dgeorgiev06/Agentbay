import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { plannedPractices } from "../components/base/forge/scripts/lib/practices.ts";
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

function plannedIn(file: string): readonly Debt[] {
  return plannedPractices(readFileSync(file, "utf8")).map((practice) => ({ id: practice.id, file }));
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
  const found = practicesFiles.flatMap(plannedIn);
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
