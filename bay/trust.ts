import { join } from "node:path";
import type { Effect, GrantedCommand, ModeList, ScriptFiles, TrustGiven } from "./contracts.ts";
import { hashOf, isRecord, parseJson } from "./json.ts";
import { pathIn, type Layout } from "./layout.ts";
import { failedWith, succeededWith, type Outcome, type Problem } from "./outcome.ts";
import type { FileSystem, Folders } from "./ports.ts";

export type TrustRecord = {
  readonly version: 1;
  readonly modes: Readonly<Record<string, TrustGiven>>;
};

export type TrustGiving = {
  readonly scripts: ScriptFiles;
  readonly at: string;
  readonly by: string;
};

export type CommandChange =
  | { readonly change: "added" | "removed" | "kept"; readonly command: GrantedCommand }
  | {
      readonly change: "changed";
      readonly command: GrantedCommand;
      readonly wordsWere?: readonly string[];
      readonly effectsWere?: readonly Effect[];
    };

export type FolderChanges = {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly kept: readonly string[];
};

export type ListChanges = {
  readonly commands: readonly CommandChange[];
  readonly folders: FolderChanges;
};

export type ScriptFileChange = {
  readonly path: string;
  readonly change: "added" | "removed" | "changed";
};

export type RecordPorts = {
  readonly files: FileSystem;
  readonly folders: Folders;
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

type FieldName = {
  readonly owner: Owner;
  readonly name: string;
};

type Elements<T> = {
  readonly is: (value: unknown) => value is T;
  readonly kind: string;
};

const recordPath = ".agentbay/trust.json";

const manifestFile = "mode.yaml";

const testsFolder = "tests/";

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
    scripts: given.scripts,
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
  const given = { list, hash: listHashOf(list), scripts: giving.scripts, at: giving.at, by: giving.by };
  const others = Object.entries(record.modes).filter(([mode]) => mode !== list.mode);
  return recordText([...others, [list.mode, given]]);
}

export function recordWithoutTrust(record: TrustRecord, mode: string): string {
  return recordText(Object.entries(record.modes).filter(([name]) => name !== mode));
}

export async function writeTrustRecord(ports: RecordPorts, layout: Layout, text: string): Promise<void> {
  const file = trustRecordFile(layout);
  await ports.files.writeAtomic(file, text);
  await ports.folders.ensureOwnerOnlyFile(file);
}

function isScriptFile(path: string): boolean {
  return path !== manifestFile && !path.startsWith(testsFolder);
}

export async function scriptFilesOf(files: FileSystem, folder: string, paths: readonly string[]): Promise<ScriptFiles> {
  const read = await Promise.all(
    paths.filter(isScriptFile).map(async (path) => [path, await files.readText(join(folder, path))] as const),
  );
  const hashed = read.flatMap(([path, text]) => (text === undefined ? [] : [[path, hashOf(text)] as const]));
  return Object.fromEntries(hashed.sort(([first], [second]) => (first < second ? -1 : 1)));
}

function hashIn(scripts: ScriptFiles, path: string): string | undefined {
  return Object.hasOwn(scripts, path) ? scripts[path] : undefined;
}

function scriptFileChange(
  path: string,
  before: string | undefined,
  now: string | undefined,
): readonly ScriptFileChange[] {
  if (before === now) {
    return [];
  }
  if (before === undefined) {
    return [{ path, change: "added" }];
  }
  return [{ path, change: now === undefined ? "removed" : "changed" }];
}

export function scriptFileChanges(before: ScriptFiles, now: ScriptFiles): readonly ScriptFileChange[] {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(now)])].sort();
  return paths.flatMap((path) => scriptFileChange(path, hashIn(before, path), hashIn(now, path)));
}

function sameWords(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((word, index) => word === second[index]);
}

function sameEffects(first: readonly Effect[], second: readonly Effect[]): boolean {
  return sameWords([...first].sort(), [...second].sort());
}

function commandChange(before: GrantedCommand | undefined, now: GrantedCommand | undefined): CommandChange | undefined {
  if (before === undefined) {
    return now === undefined ? undefined : { change: "added", command: now };
  }
  if (now === undefined) {
    return { change: "removed", command: before };
  }
  const wordsSame = sameWords(before.words, now.words);
  const effectsSame = sameEffects(before.effects, now.effects);
  if (wordsSame && effectsSame) {
    return { change: "kept", command: now };
  }
  return {
    change: "changed",
    command: now,
    ...(wordsSame ? {} : { wordsWere: before.words }),
    ...(effectsSame ? {} : { effectsWere: before.effects }),
  };
}

function commandNamed(commands: readonly GrantedCommand[], name: string): GrantedCommand | undefined {
  return commands.find((command) => command.name === name);
}

export function listChanges(before: ModeList, now: ModeList): ListChanges {
  const names = [...new Set([...before.commands, ...now.commands].map((command) => command.name))].sort();
  const commands = names.flatMap(
    (name) => commandChange(commandNamed(before.commands, name), commandNamed(now.commands, name)) ?? [],
  );
  const folders = {
    added: now.throwaway.filter((folder) => !before.throwaway.includes(folder)),
    removed: before.throwaway.filter((folder) => !now.throwaway.includes(folder)),
    kept: now.throwaway.filter((folder) => before.throwaway.includes(folder)),
  };
  return { commands, folders };
}

const redrawingMarks: readonly number[] = [
  0x061c, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x2028, 0x2029, 0x2060, 0xfeff,
];

function isRedrawing(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
    redrawingMarks.includes(code) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2066 && code <= 0x2069)
  );
}

export function shown(text: string): string {
  return Array.from(text)
    .map((character) => {
      const code = character.charCodeAt(0);
      return isRedrawing(code) ? `\\u${code.toString(16).padStart(4, "0")}` : character;
    })
    .join("");
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

function isText(value: unknown): value is string {
  return typeof value === "string";
}

function isEffect(value: unknown): value is Effect {
  return typeof value === "string" && effects.includes(value);
}

const texts: Elements<string> = { is: isText, kind: "a list of texts" };

const effectList: Elements<Effect> = { is: isEffect, kind: "a list of effects" };

function elementsAt<T>(at: FieldName, elements: Elements<T>, problems: Problem[]): readonly T[] | undefined {
  const field = fieldAt(at.owner, at.name, problems);
  if (field === undefined) {
    return undefined;
  }
  const { value } = field;
  if (Array.isArray(value) && value.every(elements.is)) {
    return value;
  }
  problems.push(wrongKind(field.place, elements.kind));
  return undefined;
}

function scriptsAt(owner: Owner, problems: Problem[]): ScriptFiles | undefined {
  const field = fieldAt(owner, "scripts", problems);
  if (field === undefined) {
    return undefined;
  }
  const { value } = field;
  if (isRecord(value) && Object.values(value).every(isText)) {
    return Object.fromEntries(Object.entries(value).flatMap(([path, hash]) => (isText(hash) ? [[path, hash]] : [])));
  }
  problems.push(wrongKind(field.place, "a map of script files to their hashes"));
  return undefined;
}

function commandOf(field: Field, problems: Problem[]): GrantedCommand | undefined {
  const owner = ownerOf(field, problems);
  if (owner === undefined) {
    return undefined;
  }
  const name = textAt(owner, "name", problems);
  const words = elementsAt({ owner, name: "words" }, texts, problems);
  const commandEffects = elementsAt({ owner, name: "effects" }, effectList, problems);
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
  const commandsStartWith = elementsAt({ owner, name: "commandsStartWith" }, texts, problems);
  const throwaway = elementsAt({ owner, name: "throwaway" }, texts, problems);
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
  const scripts = scriptsAt(entry, problems);
  const at = textAt(entry, "at", problems);
  const by = textAt(entry, "by", problems);
  if (list === undefined || hash === undefined || scripts === undefined || at === undefined || by === undefined) {
    return undefined;
  }
  return { list, hash, scripts, at, by };
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
