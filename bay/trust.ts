import type { Effect, GrantedCommand, ModeList, TrustGiven } from "./contracts.ts";
import { hashOf, isRecord, parseJson } from "./json.ts";
import { pathIn, type Layout } from "./layout.ts";
import { failedWith, succeededWith, type Outcome, type Problem } from "./outcome.ts";
import type { FileSystem } from "./ports.ts";

export type TrustRecord = {
  readonly version: 1;
  readonly modes: Readonly<Record<string, TrustGiven>>;
};

export type TrustGiving = {
  readonly at: string;
  readonly by: string;
};

type Place = readonly (string | number)[];

type Field = {
  readonly value: unknown;
  readonly place: Place;
};

type Owner = {
  readonly fields: Readonly<Record<string, unknown>>;
  readonly place: Place;
};

const recordPath = ".agentbay/trust.json";

const effects: readonly string[] = ["read", "write", "network", "spend", "delete"] satisfies readonly Effect[];

const noneGranted = "so no list it holds is granted";

const fix = "Remove the file; then each mode outside the kit's components/base/ waits until the owner trusts it again.";

function trustRecordFile(layout: Layout): string {
  return pathIn(layout, "project", recordPath);
}

export function listHashOf(list: ModeList): string {
  const commands = Object.fromEntries(
    list.commands.map((command) => [command.name, { words: command.words, effects: [...command.effects].sort() }]),
  );
  return hashOf({
    mode: list.mode,
    commands,
    commandsStartWith: list.commandsStartWith,
    throwaway: [...list.throwaway].sort(),
  });
}

function entryText(given: TrustGiven): TrustGiven {
  const { list } = given;
  return {
    list: {
      mode: list.mode,
      commands: list.commands.map((command) => ({
        name: command.name,
        words: command.words,
        effects: command.effects,
      })),
      commandsStartWith: list.commandsStartWith,
      throwaway: list.throwaway,
    },
    hash: given.hash,
    at: given.at,
    by: given.by,
  };
}

function byMode(first: readonly [string, TrustGiven], second: readonly [string, TrustGiven]): number {
  return first[0] < second[0] ? -1 : 1;
}

function recordText(entries: readonly (readonly [string, TrustGiven])[]): string {
  const modes = Object.fromEntries([...entries].sort(byMode).map(([mode, given]) => [mode, entryText(given)]));
  return `${JSON.stringify({ version: 1, modes }, null, 2)}\n`;
}

export function recordWithTrust(record: TrustRecord, list: ModeList, giving: TrustGiving): string {
  const given = { list, hash: listHashOf(list), at: giving.at, by: giving.by };
  const others = Object.entries(record.modes).filter(([mode]) => mode !== list.mode);
  return recordText([...others, [list.mode, given]]);
}

export function recordWithoutTrust(record: TrustRecord, mode: string): string {
  return recordText(Object.entries(record.modes).filter(([name]) => name !== mode));
}

function problemAt(place: Place, message: string): Problem {
  return { file: recordPath, path: place.map((part) => `/${String(part)}`).join(""), message, fix };
}

function missing(place: Place): Problem {
  return problemAt(place, `The trust record ${recordPath} has no field ${place.join(".")}, ${noneGranted}.`);
}

function wrongKind(place: Place, kind: string): Problem {
  return problemAt(
    place,
    `The field ${place.join(".")} of the trust record ${recordPath} is not ${kind}, ${noneGranted}.`,
  );
}

function fieldAt(owner: Owner, name: string, problems: Problem[]): Field | undefined {
  const place = [...owner.place, name];
  if (!Object.hasOwn(owner.fields, name)) {
    problems.push(missing(place));
    return undefined;
  }
  return { value: owner.fields[name], place };
}

function ownerOf(field: Field, problems: Problem[]): Owner | undefined {
  if (isRecord(field.value)) {
    return { fields: field.value, place: field.place };
  }
  problems.push(wrongKind(field.place, "an object"));
  return undefined;
}

function ownerAt(owner: Owner, name: string, problems: Problem[]): Owner | undefined {
  const field = fieldAt(owner, name, problems);
  return field === undefined ? undefined : ownerOf(field, problems);
}

function textAt(owner: Owner, name: string, problems: Problem[]): string | undefined {
  const field = fieldAt(owner, name, problems);
  if (field === undefined) {
    return undefined;
  }
  if (typeof field.value === "string") {
    return field.value;
  }
  problems.push(wrongKind(field.place, "a text"));
  return undefined;
}

function textsAt(owner: Owner, name: string, problems: Problem[]): readonly string[] | undefined {
  const field = fieldAt(owner, name, problems);
  if (field === undefined) {
    return undefined;
  }
  const { value } = field;
  if (Array.isArray(value) && value.every((element) => typeof element === "string")) {
    return value;
  }
  problems.push(wrongKind(field.place, "a list of texts"));
  return undefined;
}

function isEffect(value: unknown): value is Effect {
  return typeof value === "string" && effects.includes(value);
}

function effectsAt(owner: Owner, name: string, problems: Problem[]): readonly Effect[] | undefined {
  const field = fieldAt(owner, name, problems);
  if (field === undefined) {
    return undefined;
  }
  const { value } = field;
  if (Array.isArray(value) && value.every(isEffect)) {
    return value;
  }
  problems.push(wrongKind(field.place, "a list of effects"));
  return undefined;
}

function commandOf(field: Field, problems: Problem[]): GrantedCommand | undefined {
  const owner = ownerOf(field, problems);
  if (owner === undefined) {
    return undefined;
  }
  const name = textAt(owner, "name", problems);
  const words = textsAt(owner, "words", problems);
  const commandEffects = effectsAt(owner, "effects", problems);
  if (name === undefined || words === undefined || commandEffects === undefined) {
    return undefined;
  }
  return { name, words, effects: commandEffects };
}

function commandsAt(owner: Owner, name: string, problems: Problem[]): readonly GrantedCommand[] | undefined {
  const field = fieldAt(owner, name, problems);
  if (field === undefined) {
    return undefined;
  }
  if (!Array.isArray(field.value)) {
    problems.push(wrongKind(field.place, "a list of commands"));
    return undefined;
  }
  const elements: readonly unknown[] = field.value;
  const read = elements.map((value, index) => commandOf({ value, place: [...field.place, index] }, problems));
  const commands = read.flatMap((command) => (command === undefined ? [] : [command]));
  return commands.length === read.length ? commands : undefined;
}

function listAt(entry: Owner, problems: Problem[]): ModeList | undefined {
  const owner = ownerAt(entry, "list", problems);
  if (owner === undefined) {
    return undefined;
  }
  const mode = textAt(owner, "mode", problems);
  const commands = commandsAt(owner, "commands", problems);
  const commandsStartWith = textsAt(owner, "commandsStartWith", problems);
  const throwaway = textsAt(owner, "throwaway", problems);
  if (mode === undefined || commands === undefined || commandsStartWith === undefined || throwaway === undefined) {
    return undefined;
  }
  return { mode, commands, commandsStartWith, throwaway };
}

function givenAt(modes: Owner, name: string, problems: Problem[]): TrustGiven | undefined {
  const entry = ownerAt(modes, name, problems);
  if (entry === undefined) {
    return undefined;
  }
  const list = listAt(entry, problems);
  const hash = textAt(entry, "hash", problems);
  const at = textAt(entry, "at", problems);
  const by = textAt(entry, "by", problems);
  if (list === undefined || hash === undefined || at === undefined || by === undefined) {
    return undefined;
  }
  return { list, hash, at, by };
}

function disagreements(name: string, given: TrustGiven): readonly Problem[] {
  const place = ["modes", name];
  const ownList =
    given.list.mode === name
      ? []
      : [
          problemAt(
            [...place, "list", "mode"],
            `The entry ${place.join(".")} of the trust record ${recordPath} holds the list of mode ` +
              `${given.list.mode}, ${noneGranted}.`,
          ),
        ];
  const ownHash =
    given.hash === listHashOf(given.list)
      ? []
      : [
          problemAt(
            [...place, "hash"],
            `The hash of mode ${name} in the trust record ${recordPath} is not the hash of the list beside it, ` +
              `${noneGranted}.`,
          ),
        ];
  return [...ownList, ...ownHash];
}

function versionProblems(root: Owner): readonly Problem[] {
  const problems: Problem[] = [];
  const field = fieldAt(root, "version", problems);
  return field === undefined || field.value === 1 ? problems : [wrongKind(field.place, "1")];
}

function modesOf(root: Owner, problems: Problem[]): Readonly<Record<string, TrustGiven>> {
  const modes = ownerAt(root, "modes", problems);
  if (modes === undefined) {
    return {};
  }
  const entries = Object.keys(modes.fields).flatMap((name) => {
    const given = givenAt(modes, name, problems);
    return given === undefined ? [] : [[name, given] as const];
  });
  problems.push(...entries.flatMap(([name, given]) => disagreements(name, given)));
  return Object.fromEntries(entries);
}

function parsedRecord(text: string): Outcome<unknown> {
  try {
    return succeededWith(parseJson(text));
  } catch {
    return failedWith([problemAt([], `The trust record ${recordPath} is not JSON, ${noneGranted}.`)]);
  }
}

function trustRecordOf(text: string | undefined): Outcome<TrustRecord> {
  if (text === undefined) {
    return succeededWith({ version: 1, modes: {} });
  }
  const parsed = parsedRecord(text);
  if (!parsed.ok) {
    return parsed;
  }
  const root = ownerOf({ value: parsed.value, place: [] }, []);
  if (root === undefined) {
    return failedWith([problemAt([], `The trust record ${recordPath} is not a JSON object, ${noneGranted}.`)]);
  }
  const problems: Problem[] = [...versionProblems(root)];
  const modes = modesOf(root, problems);
  return problems.length > 0 ? failedWith(problems) : succeededWith({ version: 1, modes });
}

async function recordFileText(files: FileSystem, layout: Layout): Promise<Outcome<string | undefined>> {
  try {
    return succeededWith(await files.readText(trustRecordFile(layout)));
  } catch {
    return failedWith([problemAt([], `The trust record ${recordPath} cannot be read, ${noneGranted}.`)]);
  }
}

export async function readTrustRecord(files: FileSystem, layout: Layout): Promise<Outcome<TrustRecord>> {
  const text = await recordFileText(files, layout);
  return text.ok ? trustRecordOf(text.value) : text;
}
