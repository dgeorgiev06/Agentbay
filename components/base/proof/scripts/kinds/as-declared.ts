import { fieldsOf, pathMatch, readYaml, type CommandRan } from "../../../../../bay/sdk.ts";
import type { Names, Request } from "../lib/request.ts";
import { basePathOf, changedPaths, headPathOf, type ChangedPath } from "../lib/size.ts";
import { inCopy, type ProofStep } from "../lib/step.ts";
import { broken, counted, held, unknown, type Part, type Parts } from "../lib/verdicts.ts";
import { changedNotKnown, touchedPaths } from "./touched.ts";

export type Declared = Request["declared"];

export type Actions = ReadonlyMap<string, string>;

export type ActionsRead =
  { readonly read: true; readonly actions: Actions } | { readonly read: false; readonly reason: string };

export type AsDeclaredEvidence =
  | { readonly found: "changed not known" }
  | { readonly found: "names not known"; readonly reason: string }
  | { readonly found: "changed"; readonly paths: readonly string[]; readonly names: Names };

type NamesRead = { readonly read: true; readonly names: Names } | { readonly read: false; readonly reason: string };

type FileText = { readonly read: true; readonly text: string } | { readonly read: false; readonly reason: string };

type Side = { readonly commit: string; readonly on: "base" | "head"; readonly paths: readonly string[] };

const actionLists = ["**/mode.yaml", "components/base/interfaces/*.yaml", "components/interfaces/*.yaml"];

const readFile = "read-file";

export function actionsIn(text: string, where: string): ActionsRead {
  const read = readYaml(text);
  if (!read.ok) {
    const line = String(read.problems[0]?.line ?? 1);
    return { read: false, reason: `${where} is not YAML at line ${line}, so its action names are not known.` };
  }
  const fields = fieldsOf(read.value);
  const actions = Object.entries(fieldsOf(fields.actions ?? null));
  if (actions.length === 0) {
    return { read: true, actions: new Map() };
  }
  const name = fields.name;
  if (typeof name !== "string") {
    return { read: false, reason: `${where} has no name, so its action names are not known.` };
  }
  return {
    read: true,
    actions: new Map(actions.map(([action, block]) => [`${name}.${action}`, JSON.stringify(block)])),
  };
}

export function namesBetween(base: Actions, head: Actions): Names {
  const headNames = [...head.keys()];
  return {
    gained: headNames.filter((name) => !base.has(name)),
    lost: [...base.keys()].filter((name) => !head.has(name)),
    changed: headNames.filter((name) => base.has(name) && base.get(name) !== head.get(name)),
  };
}

function missingFrom(wanted: readonly string[], given: readonly string[]): number {
  return wanted.filter((entry) => !given.includes(entry)).length;
}

function namesMissingFrom(wanted: Names, given: Names): number {
  return (
    missingFrom(wanted.gained, given.gained) +
    missingFrom(wanted.lost, given.lost) +
    missingFrom(wanted.changed, given.changed)
  );
}

function differences(declared: Declared, paths: readonly string[], names: Names): readonly Part[] {
  const found = [
    {
      count: missingFrom(paths, declared.files),
      one: "changed file was",
      many: "changed files were",
      end: "not declared",
    },
    {
      count: missingFrom(declared.files, paths),
      one: "declared file did",
      many: "declared files did",
      end: "not change",
    },
    {
      count: namesMissingFrom(names, declared.names),
      one: "action name changed and was",
      many: "action names changed and were",
      end: "not declared",
    },
    {
      count: namesMissingFrom(declared.names, names),
      one: "declared action name did",
      many: "declared action names did",
      end: "not change as declared",
    },
  ];
  return found.flatMap((each) =>
    each.count === 0 ? [] : [broken(`${counted(each.count, each.one, each.many)} ${each.end}.`)],
  );
}

export function asDeclaredParts(declared: Declared, evidence: AsDeclaredEvidence): Parts {
  switch (evidence.found) {
    case "changed not known":
      return { parts: [unknown(changedNotKnown)], whenPassed: "" };
    case "names not known":
      return { parts: [unknown(evidence.reason)], whenPassed: "" };
    case "changed": {
      const { paths, names } = evidence;
      const [first, ...rest] = differences(declared, paths, names);
      const nameCount = names.gained.length + names.lost.length + names.changed.length;
      const files = counted(paths.length, "file", "files");
      return {
        parts: first === undefined ? [held] : [first, ...rest],
        whenPassed: `What changed is as declared: ${files} and ${counted(nameCount, "action name", "action names")}.`,
      };
    }
  }
}

function isActionList(path: string): boolean {
  return actionLists.some((pattern) => pathMatch(pattern, path).kind === "matched");
}

function endSaid(ran: CommandRan, where: string, seconds: number): string | undefined {
  switch (ran.end.how) {
    case "timed-out":
      return `Reading ${where} did not finish within ${String(seconds)} seconds.`;
    case "signalled":
      return `Reading ${where} was stopped by the signal ${ran.end.signal}.`;
    case "exited":
      if (ran.end.exitCode !== 0) {
        return `Reading ${where} ended with the exit code ${String(ran.end.exitCode)}.`;
      }
      return ran.stdout.cut ? `${where} is longer than proof reads, so its action names are not known.` : undefined;
  }
}

type InCopy = { readonly folder: string; readonly path: string; readonly where: string };

async function fileText(step: ProofStep, file: InCopy): Promise<FileText> {
  const { folder, path, where } = file;
  const seconds = step.secondsLeft(1);
  if (seconds < 1) {
    return { read: false, reason: `${where} was not read: proof's own step had no time left for it.` };
  }
  const answer = await step.context.commands.run({
    name: readFile,
    arguments: [path],
    folder,
    timeLimitSeconds: seconds,
  });
  if (!answer.ok) {
    step.spend(seconds);
    return { read: false, reason: `${where} could not be read: ${answer.message}` };
  }
  step.spend(answer.value.milliseconds / 1000);
  const ended = endSaid(answer.value, where, seconds);
  return ended === undefined ? { read: true, text: answer.value.stdout.text } : { read: false, reason: ended };
}

async function actionsInCopy(step: ProofStep, folder: string, side: Side): Promise<ActionsRead> {
  const actions = new Map<string, string>();
  for (const path of side.paths) {
    const where = `${path} at the ${side.on}`;
    const text = await fileText(step, { folder, path, where });
    const read = text.read ? actionsIn(text.text, where) : text;
    if (!read.read) {
      return read;
    }
    for (const [name, block] of read.actions) {
      actions.set(name, block);
    }
  }
  return { read: true, actions };
}

async function actionsAt(step: ProofStep, side: Side): Promise<ActionsRead> {
  if (side.paths.length === 0) {
    return { read: true, actions: new Map() };
  }
  return inCopy(step, side.commit, (copy) =>
    copy.made ? actionsInCopy(step, copy.folder, side) : Promise.resolve({ read: false, reason: copy.reason }),
  );
}

async function namesChanged(step: ProofStep, request: Request, changed: readonly ChangedPath[]): Promise<NamesRead> {
  const listsAt = (pathOf: (entry: ChangedPath) => string | undefined): readonly string[] =>
    changed.flatMap((entry) => pathOf(entry) ?? []).filter(isActionList);
  const base = await actionsAt(step, { commit: request.base, on: "base", paths: listsAt(basePathOf) });
  if (!base.read) {
    return base;
  }
  const head = await actionsAt(step, { commit: request.head, on: "head", paths: listsAt(headPathOf) });
  return head.read ? { read: true, names: namesBetween(base.actions, head.actions) } : head;
}

export async function asDeclaredEvidence(step: ProofStep, request: Request): Promise<AsDeclaredEvidence> {
  const changed = await changedPaths(step, request);
  if (changed === undefined) {
    return { found: "changed not known" };
  }
  const names = await namesChanged(step, request, changed);
  if (!names.read) {
    return { found: "names not known", reason: names.reason };
  }
  return { found: "changed", paths: touchedPaths(changed), names: names.names };
}

export async function proveAsDeclared(step: ProofStep, request: Request): Promise<Parts> {
  return asDeclaredParts(request.declared, await asDeclaredEvidence(step, request));
}
