export type KeySegment =
  | { readonly kind: "step"; readonly index: number }
  | { readonly kind: "end" }
  | { readonly kind: "workflow"; readonly id: string }
  | { readonly kind: "item"; readonly index: number }
  | { readonly kind: "undo"; readonly index: number }
  | { readonly kind: "round"; readonly round: number }
  | { readonly kind: "check"; readonly index: number }
  | { readonly kind: "call"; readonly index: number };

export type StepKey = readonly KeySegment[];

export type SkillRound = {
  readonly step: string;
  readonly round: number;
};

type Reading = {
  readonly segment: KeySegment;
  readonly length: number;
};

type Reader = (rest: string, previous: KeySegment | undefined) => Reading | undefined;

const workflowId = "[a-z][a-z0-9]*(?:-[a-z0-9]+)*";

const count = "(0|[1-9][0-9]*)";

function segmentText(segment: KeySegment): string {
  switch (segment.kind) {
    case "step":
      return String(segment.index);
    case "end":
      return "end";
    case "workflow":
      return segment.id;
    case "item":
      return `[${String(segment.index)}]`;
    case "undo":
      return `undo[${String(segment.index)}]`;
    case "round":
      return `#${String(segment.round)}`;
    case "check":
      return `.check${String(segment.index)}`;
    case "call":
      return `.call${String(segment.index)}`;
  }
}

function separatorBefore(segment: KeySegment): string {
  switch (segment.kind) {
    case "step":
    case "end":
      return "/";
    case "workflow":
      return ".";
    case "item":
    case "undo":
    case "round":
    case "check":
    case "call":
      return "";
  }
}

function appended(parent: string, segment: KeySegment): string {
  return parent === "" ? segmentText(segment) : `${parent}${separatorBefore(segment)}${segmentText(segment)}`;
}

export function stepKeyText(key: StepKey): string {
  return key.reduce(appended, "");
}

export function actionStepKey(frame: string, index: number): string {
  return appended(frame, { kind: "step", index });
}

export function actionEndKey(frame: string): string {
  return appended(frame, { kind: "end" });
}

export function skillRoundKey(step: string, round: number): string {
  return appended(step, { kind: "round", round });
}

export function checkStepKey(step: string, round: number, index: number): string {
  return appended(skillRoundKey(step, round), { kind: "check", index });
}

export function scriptCallKey(script: string, index: number): string {
  return appended(script, { kind: "call", index });
}

export function workflowStepKey(item: string, id: string): string {
  return appended(item, { kind: "workflow", id });
}

export function foreachItemKey(foreach: string, index: number): string {
  return appended(foreach, { kind: "item", index });
}

export function undoStepKey(index: number): string {
  return appended("", { kind: "undo", index });
}

function matched(pattern: string, rest: string): RegExpExecArray | null {
  return new RegExp(`^(?:${pattern})`).exec(rest);
}

function numberAt(match: RegExpExecArray): number {
  return Number(match[1] ?? "");
}

function readCounted(rest: string, pattern: string): number | undefined {
  const match = matched(pattern, rest);
  return match === null ? undefined : numberAt(match);
}

const readFirst: Reader = (rest) => {
  const undo = readCounted(rest, `undo\\[${count}\\](?=/|$)`);
  if (undo !== undefined) {
    return { segment: { kind: "undo", index: undo }, length: `undo[${String(undo)}]`.length };
  }
  const step = readCounted(rest, count);
  if (step !== undefined) {
    return { segment: { kind: "step", index: step }, length: String(step).length };
  }
  if (matched("end$", rest) !== null) {
    return { segment: { kind: "end" }, length: 3 };
  }
  const id = matched(workflowId, rest);
  return id === null ? undefined : { segment: { kind: "workflow", id: id[0] }, length: id[0].length };
};

const readStep: Reader = (rest) => {
  if (matched("/end$", rest) !== null) {
    return { segment: { kind: "end" }, length: 4 };
  }
  const step = matched(`/${count}`, rest);
  return step === null ? undefined : { segment: { kind: "step", index: numberAt(step) }, length: step[0].length };
};

const readBracketOrRound: Reader = (rest, previous) => {
  const item = previous?.kind === "workflow" ? matched(`\\[${count}\\]`, rest) : null;
  if (item !== null) {
    return { segment: { kind: "item", index: numberAt(item) }, length: item[0].length };
  }
  const round = previous?.kind === "step" ? matched(`#${count}`, rest) : null;
  return round === null ? undefined : { segment: { kind: "round", round: numberAt(round) }, length: round[0].length };
};

const readItemStep: Reader = (rest, previous) => {
  const id = previous?.kind === "item" ? matched(`\\.(${workflowId})`, rest) : null;
  return id === null ? undefined : { segment: { kind: "workflow", id: id[1] ?? "" }, length: id[0].length };
};

const readCheck: Reader = (rest, previous) => {
  const check = previous?.kind === "round" ? matched(`\\.check${count}`, rest) : null;
  return check === null ? undefined : { segment: { kind: "check", index: numberAt(check) }, length: check[0].length };
};

const callers: readonly KeySegment["kind"][] = ["step", "check", "call"];

const readCall: Reader = (rest, previous) => {
  const call = previous !== undefined && callers.includes(previous.kind) ? matched(`\\.call${count}`, rest) : null;
  return call === null ? undefined : { segment: { kind: "call", index: numberAt(call) }, length: call[0].length };
};

const readers: readonly Reader[] = [readStep, readBracketOrRound, readItemStep, readCheck, readCall];

function readNext(rest: string, previous: KeySegment | undefined): Reading | undefined {
  if (previous === undefined) {
    return readFirst(rest, previous);
  }
  for (const reader of readers) {
    const reading = reader(rest, previous);
    if (reading !== undefined) {
      return reading;
    }
  }
  return undefined;
}

export function parseStepKey(text: string): StepKey | undefined {
  const segments: KeySegment[] = [];
  let rest = text;
  while (rest !== "") {
    const reading = readNext(rest, segments.at(-1));
    if (reading === undefined) {
      return undefined;
    }
    segments.push(reading.segment);
    rest = rest.slice(reading.length);
  }
  return segments.length === 0 ? undefined : segments;
}

export function skillRoundOf(text: string): SkillRound | undefined {
  const key = parseStepKey(text);
  const last = key?.at(-1);
  if (key === undefined || last?.kind !== "round") {
    return undefined;
  }
  return { step: stepKeyText(key.slice(0, -1)), round: last.round };
}

export function isUndoKey(text: string): boolean {
  return parseStepKey(text)?.[0]?.kind === "undo";
}

export function isInsideFrame(text: string, frame: string): boolean {
  const key = parseStepKey(text);
  const outer = parseStepKey(frame);
  if (key === undefined || outer === undefined || key.length <= outer.length) {
    return false;
  }
  const next = key[outer.length];
  return stepKeyText(key.slice(0, outer.length)) === frame && (next?.kind === "step" || next?.kind === "end");
}
