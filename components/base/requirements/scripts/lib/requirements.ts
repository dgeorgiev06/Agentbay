import { fieldsOf, type Json, type JsonFields } from "../../../../../bay/sdk.ts";

export type Path = readonly (string | number)[];

export const conditionFields = ["given", "when", "then", "after"] as const;

export type ConditionField = (typeof conditionFields)[number];

export type Text = {
  readonly field: ConditionField;
  readonly text: string;
};

export type Condition = {
  readonly at: Path;
  readonly id: string | undefined;
  readonly refused: boolean;
  readonly texts: readonly Text[];
};

export type Outcome = {
  readonly at: Path;
  readonly id: string | undefined;
  readonly noRefusal: boolean;
  readonly conditions: readonly Condition[];
};

export type Question = {
  readonly at: Path;
  readonly id: string | undefined;
  readonly answers: number;
  readonly recommended: number | undefined;
};

export type Listed = {
  readonly at: Path;
  readonly id: string;
};

export type Change = {
  readonly at: Path;
  readonly version: number | undefined;
  readonly added: readonly Listed[];
  readonly changed: readonly Listed[];
  readonly removed: readonly Listed[];
};

export type Requirements = {
  readonly job: string | undefined;
  readonly version: number | undefined;
  readonly outcomes: readonly Outcome[];
  readonly open: readonly Question[];
  readonly changes: readonly Change[];
};

function textAt(fields: JsonFields, key: string): string | undefined {
  const value = fields[key];
  return typeof value === "string" ? value : undefined;
}

function numberAt(fields: JsonFields, key: string): number | undefined {
  const value = fields[key];
  return typeof value === "number" ? value : undefined;
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function listAt(fields: JsonFields, key: string): readonly Json[] {
  const entries = fields[key];
  return isList(entries) ? entries : [];
}

function textsOf(fields: JsonFields): readonly Text[] {
  return conditionFields.flatMap((field) => {
    const text = textAt(fields, field);
    return text === undefined ? [] : [{ field, text }];
  });
}

function conditionOf(value: Json, at: Path): Condition {
  const fields = fieldsOf(value);
  return { at, id: textAt(fields, "id"), refused: fields.path === "refused", texts: textsOf(fields) };
}

function outcomeOf(value: Json, at: Path): Outcome {
  const fields = fieldsOf(value);
  return {
    at,
    id: textAt(fields, "id"),
    noRefusal: textAt(fields, "noRefusal") !== undefined,
    conditions: listAt(fields, "conditions").map((condition, index) =>
      conditionOf(condition, [...at, "conditions", index]),
    ),
  };
}

function questionOf(value: Json, at: Path): Question {
  const fields = fieldsOf(value);
  return {
    at,
    id: textAt(fields, "id"),
    answers: listAt(fields, "answers").length,
    recommended: numberAt(fields, "recommended"),
  };
}

function listedAt(fields: JsonFields, key: string, at: Path): readonly Listed[] {
  return listAt(fields, key).flatMap((id, index) => (typeof id === "string" ? [{ at: [...at, key, index], id }] : []));
}

function changeOf(value: Json, at: Path): Change {
  const fields = fieldsOf(value);
  return {
    at,
    version: numberAt(fields, "version"),
    added: listedAt(fields, "added", at),
    changed: listedAt(fields, "changed", at),
    removed: listedAt(fields, "removed", at),
  };
}

function entriesAt<T>(fields: JsonFields, key: string, entryOf: (value: Json, at: Path) => T): readonly T[] {
  return listAt(fields, key).map((value, index) => entryOf(value, [key, index]));
}

export function requirementsOf(value: Json): Requirements {
  const fields = fieldsOf(value);
  return {
    job: textAt(fields, "job"),
    version: numberAt(fields, "version"),
    outcomes: entriesAt(fields, "outcomes", outcomeOf),
    open: entriesAt(fields, "open", questionOf),
    changes: entriesAt(fields, "changes", changeOf),
  };
}

export function conditionsOf(requirements: Requirements): readonly Condition[] {
  return requirements.outcomes.flatMap((outcome) => outcome.conditions);
}
