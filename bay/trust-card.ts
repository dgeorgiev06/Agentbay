import type { Effect, GrantedCommand, ModeList, TrustGiven } from "./contracts.ts";
import {
  listChanges,
  listHashOf,
  shown,
  type CommandChange,
  type ListChanges,
  type ScriptFileChange,
} from "./trust.ts";

export type FirstCard = {
  readonly list: ModeList;
  readonly folder: string;
};

export type ChangedList = {
  readonly list: ModeList;
  readonly given: TrustGiven;
  readonly changedScripts: number;
};

export type ChangedScripts = {
  readonly given: TrustGiven;
  readonly changes: readonly ScriptFileChange[];
  readonly hash: string;
};

type Rooms = {
  readonly first: number;
  readonly rest: number;
};

type Indents = {
  readonly first: string;
  readonly rest: string;
};

type Segment = {
  readonly label: string;
  readonly tokens: readonly string[];
};

type Table = {
  readonly marked: boolean;
  readonly nameWidth: number;
};

const width = 44;

const nameWidthAtMost = 16;

const shortHashLength = 12;

const wasLabel = "was";

const meaning = [
  "The effects are the mode's own claim.",
  "Its scripts choose the arguments.",
  "You trust exactly this list. Any change",
  "to it asks you again.",
];

function columns(text: string): number {
  return Array.from(text).length;
}

function pieces(token: string, room: number): readonly string[] {
  const characters = Array.from(token);
  if (characters.length <= room) {
    return [token];
  }
  const count = Math.ceil(characters.length / room);
  return Array.from({ length: count }, (_, index) => characters.slice(index * room, (index + 1) * room).join(""));
}

function fitted(tokens: readonly string[], rooms: Rooms): readonly string[] {
  const lines: string[] = [];
  let line = "";
  for (const token of tokens.flatMap((whole) => pieces(whole, Math.min(rooms.first, rooms.rest)))) {
    const joined = line === "" ? token : `${line} ${token}`;
    const room = lines.length === 0 ? rooms.first : rooms.rest;
    if (columns(joined) <= room) {
      line = joined;
    } else {
      lines.push(line);
      line = token;
    }
  }
  return [...lines, line];
}

function hanging(tokens: readonly string[], indents: Indents): readonly string[] {
  const rooms = { first: width - indents.first.length, rest: width - indents.rest.length };
  return fitted(tokens, rooms).map((line, index) => `${index === 0 ? indents.first : indents.rest}${line}`);
}

function paragraph(text: string): readonly string[] {
  return hanging(text.split(" "), { first: "", rest: "" });
}

function indented(text: string): readonly string[] {
  return hanging([text], { first: "  ", rest: "  " });
}

function listed(items: readonly string[]): readonly string[] {
  return items.map((item, index) => (index < items.length - 1 ? `${item},` : item));
}

function effectTokens(effects: readonly Effect[]): readonly string[] {
  return listed(effects);
}

function wordTokens(words: readonly string[]): readonly string[] {
  return words.map(shown);
}

function counted(count: number, noun: string): string | undefined {
  if (count === 0) {
    return undefined;
  }
  return `${String(count)} ${noun}${count === 1 ? "" : "s"}`;
}

function hashLine(hash: string): string {
  return `hash ${hash.slice(0, shortHashLength)}`;
}

function byName(first: GrantedCommand, second: GrantedCommand): number {
  return first.name < second.name ? -1 : 1;
}

function nameWidthOf(names: readonly string[]): number {
  return Math.min(nameWidthAtMost, Math.max(0, ...names.map((name) => columns(shown(name)))));
}

function leadOf(table: Table, marker: string): string {
  return table.marked ? `  ${marker} ` : "  ";
}

function cellOf(table: Table, label: string): string {
  return label === wasLabel ? label.padStart(table.nameWidth) : label.padEnd(table.nameWidth);
}

function segmentLines(table: Table, segment: Segment, lead: string): readonly string[] {
  const blank = " ".repeat(lead.length + table.nameWidth + 2);
  const room = width - blank.length;
  const right = fitted(segment.tokens, { first: room, rest: room });
  if (columns(segment.label) > table.nameWidth) {
    return [...hanging([segment.label], { first: lead, rest: lead }), ...right.map((line) => `${blank}${line}`)];
  }
  return right.map((line, index) => `${index === 0 ? `${lead}${cellOf(table, segment.label)}  ` : blank}${line}`);
}

function rowLines(table: Table, marker: string, segments: readonly Segment[]): readonly string[] {
  return segments.flatMap((segment, index) => segmentLines(table, segment, leadOf(table, index === 0 ? marker : " ")));
}

function commandSegments(command: GrantedCommand): readonly Segment[] {
  return [
    { label: shown(command.name), tokens: wordTokens(command.words) },
    { label: "", tokens: effectTokens(command.effects) },
  ];
}

function commandSection(commands: readonly GrantedCommand[]): readonly string[] {
  if (commands.length === 0) {
    return [];
  }
  const each = commands.length === 1 ? "It runs" : "Each runs";
  const table = { marked: false, nameWidth: nameWidthOf(commands.map((command) => command.name)) };
  return [
    ...paragraph(`It lists ${counted(commands.length, "command") ?? ""}. ${each} unconfined.`),
    ...[...commands].sort(byName).flatMap((command) => rowLines(table, "", commandSegments(command))),
  ];
}

function folderSection(throwaway: readonly string[]): readonly string[] {
  if (throwaway.length === 0) {
    return [];
  }
  return [
    ...paragraph(
      `It names ${counted(throwaway.length, "throwaway folder") ?? ""}. The kernel makes and removes folders there.`,
    ),
    ...throwaway.flatMap((folder) => indented(shown(folder))),
  ];
}

export function trustCard(card: FirstCard): readonly string[] {
  const { list } = card;
  return [
    ...paragraph(`Trust the mode ${shown(list.mode)}?`),
    ...indented(shown(card.folder)),
    "",
    ...commandSection(list.commands),
    ...folderSection(list.throwaway),
    "",
    ...meaning,
    "",
    hashLine(listHashOf(list)),
  ];
}

const markers: Readonly<Record<CommandChange["change"], string>> = {
  added: "+",
  removed: "-",
  changed: "~",
  kept: "=",
};

function changedSegments(change: CommandChange): readonly Segment[] {
  if (change.change !== "changed") {
    return commandSegments(change.command);
  }
  const { command, wordsWere, effectsWere } = change;
  return [
    { label: shown(command.name), tokens: wordTokens(command.words) },
    ...(wordsWere === undefined ? [] : [{ label: wasLabel, tokens: wordTokens(wordsWere) }]),
    { label: "", tokens: effectTokens(command.effects) },
    ...(effectsWere === undefined ? [] : [{ label: wasLabel, tokens: effectTokens(effectsWere) }]),
  ];
}

function commandChanges(changes: ListChanges): readonly string[] {
  const shownChanges = changes.commands.flatMap((change) => (change.change === "kept" ? [] : [change]));
  const table = { marked: true, nameWidth: nameWidthOf(shownChanges.map((change) => change.command.name)) };
  return shownChanges.flatMap((change) => rowLines(table, markers[change.change], changedSegments(change)));
}

function folderChanges(changes: ListChanges): readonly string[] {
  const added = changes.folders.added.map((folder) => ["+", folder] as const);
  const removed = changes.folders.removed.map((folder) => ["-", folder] as const);
  return [...added, ...removed].flatMap(([marker, folder]) =>
    hanging([marker, "folder", shown(folder)], { first: "  ", rest: "    " }),
  );
}

function stayedLine(changes: ListChanges): readonly string[] {
  const names = changes.commands.flatMap((change) => (change.change === "kept" ? [change.command.name] : []));
  const folders = changes.folders.kept;
  const stayed = [...names.map(shown), ...folders.map((folder) => `folder ${shown(folder)}`)];
  const items = stayed.length === 0 ? ["nothing"] : listed(stayed);
  return hanging(["=", "as", "before:", ...items], { first: "  ", rest: "    " });
}

function scriptsSentence(changedScripts: number): string {
  if (changedScripts === 0) {
    return "None of its script files changed.";
  }
  return `${String(changedScripts)} of its script files changed as well.`;
}

export function trustedWhen(given: TrustGiven): string {
  return `You trusted it on ${shown(given.at.slice(0, 10))}, as the ${shown(given.by)}.`;
}

export function listSize(list: ModeList): string {
  const parts = [counted(list.commands.length, "command"), counted(list.throwaway.length, "throwaway folder")];
  return parts.flatMap((part) => (part === undefined ? [] : [part])).join(", ");
}

export function differenceCard(change: ChangedList): readonly string[] {
  const { list, given } = change;
  const changes = listChanges(given.list, list);
  return [
    ...paragraph(`The mode ${shown(list.mode)} changed its list.`),
    ...paragraph(`${trustedWhen(given)} None of it runs until you decide.`),
    "",
    ...commandChanges(changes),
    ...folderChanges(changes),
    ...stayedLine(changes),
    "",
    ...paragraph(scriptsSentence(change.changedScripts)),
    "",
    hashLine(listHashOf(list)),
  ];
}

const scriptMarkers: Readonly<Record<ScriptFileChange["change"], string>> = {
  added: "+",
  removed: "-",
  changed: "~",
};

export function scriptsCard(card: ChangedScripts): readonly string[] {
  const { given, changes } = card;
  return [
    ...paragraph(`The script files of the mode ${shown(given.list.mode)} changed. Its list is as you trusted it.`),
    ...paragraph(trustedWhen(given)),
    "",
    ...changes.flatMap(({ path, change }) =>
      hanging([scriptMarkers[change], shown(path)], { first: "  ", rest: "    " }),
    ),
    "",
    ...paragraph(
      "Its scripts choose the arguments of its commands. The listed words still bound what any script can run.",
    ),
    "",
    hashLine(card.hash),
  ];
}

export function withdrawCard(given: TrustGiven): readonly string[] {
  const { list } = given;
  const parts = [counted(list.commands.length, "command"), counted(list.throwaway.length, "throwaway folder")];
  const named = parts.flatMap((part) => (part === undefined ? [] : [part]));
  const one = list.commands.length + list.throwaway.length === 1;
  return [
    ...paragraph(`Withdraw trust from the mode ${shown(list.mode)}?`),
    ...paragraph(
      `Its ${named.join(" and ")} ${one ? "stops" : "stop"} being granted. ` +
        `A run that needs ${one ? "it" : "them"} is refused until you trust the mode again.`,
    ),
    "",
    hashLine(given.hash),
  ];
}
