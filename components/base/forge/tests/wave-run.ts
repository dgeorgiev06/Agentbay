import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import {
  allHeld,
  bay,
  builderWrites,
  git,
  into,
  provedIn,
  runOf,
  textAt,
  waitingOf,
  type Handed,
  type Players,
  type Proved,
  type Waiting,
} from "./kit-copy.ts";

const planFile = "docs/plans/0099-wave.yaml";

export const agreed = "components/base/interfaces/proof.yaml";

export function lower(name: string): string {
  return name.toLowerCase();
}

export function testPath(name: string): string {
  return `components/modes/${lower(name)}/tests/${lower(name)}.test.ts`;
}

export function codeOf(name: string): string {
  return `components/modes/${lower(name)}/scripts/${lower(name)}.ts`;
}

export function plannedSlice(name: string): Json {
  return {
    title: `The ${lower(name)} mode counts what was added`,
    interface: [agreed],
    slice: {
      name,
      kind: "mode",
      scope: [`components/modes/${lower(name)}/**`],
      after: [],
      done: [
        {
          id: `DOD-${name}-1`,
          says: "What was added is counted.",
          level: "must",
          proof: { kind: "fails-first", tests: [testPath(name)] },
        },
        { id: `DOD-${name}-2`, says: "The checks pass.", level: "must", proof: { kind: "checks" } },
      ],
    },
  };
}

export function testsOf(name: string): Handed {
  const text = `test("${lower(name)} counts one added thing", () => count${name}() === 1);\n`;
  return { path: testPath(name), text };
}

export function ownPassed(name: string): Proved {
  return {
    verdicts: [
      { item: `DOD-${name}-1`, kind: "fails-first", verdict: "passed", detail: "It held." },
      { item: "scope", kind: "in-scope", verdict: "passed", detail: "It held." },
      { item: "declared", kind: "as-declared", verdict: "passed", detail: "It held." },
    ],
    judgement: [],
    size: [{ path: codeOf(name), head: 1 }],
  };
}

export function ownFailed(name: string): Proved {
  const failed = {
    item: `DOD-${name}-1`,
    kind: "fails-first",
    verdict: "failed",
    detail: "The named tests fail on the head.",
  };
  return { ...ownPassed(name), verdicts: [failed, ...ownPassed(name).verdicts.slice(1)] };
}

export function checksPassed(item: string): Proved {
  const detail = "Every check passed (typecheck, lint), and so did the test run: 40 tests.";
  return { verdicts: [{ item, kind: "checks", verdict: "passed", detail }], judgement: [], size: [] };
}

export function checksFailed(item: string, failing: string): Proved {
  const cases = {
    failures: [
      { name: failing, file: "/tmp/copy/tests/store.test.ts", message: "expected 3 tables", charactersCut: 0 },
    ],
    failuresNotListed: 0,
    notLoaded: [],
  };
  const verdict = { item, kind: "checks", verdict: "failed", detail: "1 test failed.", cases };
  return { verdicts: [verdict], judgement: [], size: [] };
}

export async function provedAs(root: string, file: string, proved: Proved): Promise<void> {
  await provedIn(root, file, proved);
}

export async function planOnInto(root: string, names: readonly string[]): Promise<void> {
  await slicesPlannedOnInto(root, names.map(plannedSlice));
}

export async function slicesPlannedOnInto(root: string, slices: readonly Json[]): Promise<void> {
  const folder = join(root, ".planning");
  git(root, ["worktree", "add", "-q", folder, into]);
  const path = join(folder, planFile);
  await mkdir(dirname(path), { recursive: true });
  const plan = { title: "A wave of counting modes", slices: [...slices] };
  await writeFile(path, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  git(folder, ["add", planFile]);
  git(folder, ["commit", "-q", "-m", "The plan of the wave"]);
  git(root, ["worktree", "remove", folder]);
}

export async function waveStarted(root: string): Promise<Waiting> {
  const trigger = JSON.stringify({ plan: planFile, wave: 1 });
  const answer = await bay(root, ["call", "--workflow", "forge:workflows/wave.yaml", trigger]);
  return waitingOf(runOf(answer), "start");
}

function sliceNameOf(task: Json): string {
  return textAt(fieldsOf(fieldsOf(task).input ?? null).slice ?? null, "name");
}

function folderOf(task: Json): string {
  return textAt(fieldsOf(task).input ?? null, "folder");
}

export type Lives = {
  readonly reviewed?: (name: string) => Promise<void>;
};

export function wavePlayers(root: string, lives: Lives = {}): Players {
  return {
    declarer: (task) => {
      const name = sliceNameOf(task);
      return Promise.resolve({ files: [codeOf(name)], names: { gained: [], lost: [], changed: [] } });
    },
    tests: (task) => Promise.resolve({ tests: [testsOf(sliceNameOf(task))] }),
    builder: async (task) => {
      await builderWrites(root, folderOf(task), [codeOf(sliceNameOf(task))]);
      return { outcome: "built" };
    },
    reviewer: async (task) => {
      await lives.reviewed?.(sliceNameOf(task));
      return allHeld(task);
    },
  };
}
