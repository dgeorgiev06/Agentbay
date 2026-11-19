import { fieldsOf, type Json } from "../../../../../bay/sdk.ts";
import type { Built, Slice } from "./cards.ts";
import type { HandedTest } from "./handed-tests.ts";
import { quotesAny } from "./quoting.ts";
import { listOf, textOf, textsOf } from "./json-values.ts";

export type Bug = {
  readonly name: string;
  readonly patch: string;
  readonly tests: readonly string[];
};

export type Planting = {
  readonly code: readonly string[];
  readonly fixed: readonly string[];
  readonly tests: readonly HandedTest[];
};

type Numbered = {
  readonly bug: Bug;
  readonly number: number;
};

export const mostPlanted = 10;

const mostHanded = 50;

const longestName = 200;

const fileLine = /^(?:diff --git a\/(\S+) b\/(\S+)|--- a\/(.+)|\+\+\+ b\/(.+))$/;

const headerLine = /^\+\+\+ (?:b\/|\/dev\/null)/;

export function bugsOf(value: Json | undefined): readonly Bug[] {
  return listOf(value).map((entry) => {
    const fields = fieldsOf(entry);
    return { name: textOf(fields.name), patch: textOf(fields.patch), tests: textsOf(fields.tests) };
  });
}

export function patchedFiles(patch: string): readonly string[] {
  const found = patch.split("\n").flatMap((line) => {
    const matched = fileLine.exec(line);
    return matched === null ? [] : matched.slice(1).filter((path) => path !== undefined);
  });
  return [...new Set(found)];
}

function addedText(patch: string): string {
  const added = patch.split("\n").filter((line) => line.startsWith("+") && !headerLine.test(line));
  return added.map((line) => line.slice(1)).join("\n");
}

function numberedBugs(answer: Json): readonly Numbered[] {
  return bugsOf(fieldsOf(answer).bugs).map((bug, at) => ({ bug, number: at + 1 }));
}

function countProblems(bugs: readonly Numbered[]): readonly string[] {
  if (bugs.length <= mostPlanted) {
    return [];
  }
  return [
    `The answer gives ${String(bugs.length)} bugs; give at most ${String(mostPlanted)}, ` +
      "those the tests are likeliest to miss.",
  ];
}

function nameProblems(bugs: readonly Numbered[]): readonly string[] {
  const names = [...new Set(bugs.map((each) => each.bug.name))];
  return names.flatMap((name) => {
    const numbers = bugs.filter((each) => each.bug.name === name).map((each) => String(each.number));
    if (numbers.length < 2) {
      return [];
    }
    const listed = `${numbers.slice(0, -1).join(", ")} and ${numbers.at(-1) ?? ""}`;
    return [`Bugs ${listed} have the same name; give each bug a name of its own.`];
  });
}

function fileProblems(label: string, bug: Bug, planting: Planting): readonly string[] {
  const files = patchedFiles(bug.patch);
  const testPaths = [...planting.fixed, ...planting.tests.map((test) => test.path)];
  if (files.length === 0) {
    return [`${label} changes no file: write its patch as git diff writes it, against the builder's code.`];
  }
  if (files.some((file) => testPaths.includes(file))) {
    return [`${label} changes a test file; plant bugs only in the builder's code.`];
  }
  const others = files.filter((file) => !planting.code.includes(file));
  if (others.length === 0) {
    return [];
  }
  return [
    `${label} changes ${others.join(", ")}, which the builder did not change; ` +
      "plant bugs only in the files given as code.",
  ];
}

function testsProblems(label: string, bug: Bug, planting: Planting): readonly string[] {
  const unnamed = bug.tests.filter((path) => !planting.fixed.includes(path));
  if (unnamed.length === 0) {
    return [];
  }
  return [
    `${label} names ${unnamed.join(", ")} among its tests, which no fails-first item names; ` +
      `name only these: ${planting.fixed.join(", ")}.`,
  ];
}

function quoteProblems(label: string, bug: Bug, planting: Planting): readonly string[] {
  const tests = planting.tests.map((test) => test.text);
  if (!quotesAny(bug.name, tests) && !quotesAny(addedText(bug.patch), tests)) {
    return [];
  }
  return [
    `${label} shares a run of 20 or more characters with the tests: write its name and its change in other words.`,
  ];
}

function bugProblems(numbered: Numbered, planting: Planting): readonly string[] {
  const label = `Bug ${String(numbered.number)}`;
  return [
    ...fileProblems(label, numbered.bug, planting),
    ...testsProblems(label, numbered.bug, planting),
    ...quoteProblems(label, numbered.bug, planting),
  ];
}

export function refusedBugs(answer: Json, planting: Planting): readonly string[] {
  const bugs = numberedBugs(answer);
  const counted = countProblems(bugs);
  if (counted.length > 0) {
    return counted;
  }
  return [...nameProblems(bugs), ...bugs.flatMap((each) => bugProblems(each, planting))];
}

function distinctName(name: string, taken: ReadonlySet<string>, number = 1): string {
  const suffix = number === 1 ? "" : ` (${String(number)})`;
  const candidate = `${Array.from(name)
    .slice(0, longestName - suffix.length)
    .join("")}${suffix}`;
  return taken.has(candidate) ? distinctName(name, taken, number + 1) : candidate;
}

export function bugsHanded(owner: readonly Bug[], planted: readonly Bug[]): readonly Bug[] {
  const taken = new Set<string>();
  return [...owner, ...planted].slice(0, mostHanded).map((bug) => {
    const name = distinctName(bug.name, taken);
    taken.add(name);
    return { ...bug, name };
  });
}

export function plants(slice: Slice, built: Built): boolean {
  return built.outcome === "built" && slice.done.some((item) => item.proof?.kind === "bugs-caught");
}
