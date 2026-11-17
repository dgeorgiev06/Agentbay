import type { Effect, GrantedCommand, ModeList, TrustGiven } from "./contracts.ts";
import { listHashOf } from "./trust.ts";

export type FirstCard = {
  readonly list: ModeList;
  readonly folder: string;
};

export type ChangedList = {
  readonly list: ModeList;
  readonly given: TrustGiven;
  readonly changedScripts: number;
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

type Marker = "+" | "-" | "~";

type CommandChange = {
  readonly marker: Marker;
  readonly segments: readonly Segment[];
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

function isRedrawing(code: number): boolean {
  return (
    code < 0x20 ||
    (code >= 0x7f && code <= 0x9f) ||
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

function sameWords(first: readonly string[], second: readonly string[]): boolean {
  return first.length === second.length && first.every((word, index) => word === second[index]);
}

function sameEffects(first: readonly Effect[], second: readonly Effect[]): boolean {
  return sameWords([...first].sort(), [...second].sort());
}

function changedSegments(before: GrantedCommand, now: GrantedCommand): readonly Segment[] {
  const wordsWere = sameWords(before.words, now.words) ? [] : [{ label: wasLabel, tokens: wordTokens(before.words) }];
  const effectsWere = sameEffects(before.effects, now.effects)
    ? []
    : [{ label: wasLabel, tokens: effectTokens(before.effects) }];
  return [
    { label: shown(now.name), tokens: wordTokens(now.words) },
    ...wordsWere,
    { label: "", tokens: effectTokens(now.effects) },
    ...effectsWere,
  ];
}

function commandChange(before: GrantedCommand | undefined, now: GrantedCommand | undefined): CommandChange | undefined {
  if (before === undefined) {
    return now === undefined ? undefined : { marker: "+", segments: commandSegments(now) };
  }
  if (now === undefined) {
    return { marker: "-", segments: commandSegments(before) };
  }
  if (sameWords(before.words, now.words) && sameEffects(before.effects, now.effects)) {
    return undefined;
  }
  return { marker: "~", segments: changedSegments(before, now) };
}

function commandNamed(commands: readonly GrantedCommand[], name: string): GrantedCommand | undefined {
  return commands.find((command) => command.name === name);
}

function commandNames(change: ChangedList): readonly string[] {
  const names = [...change.given.list.commands, ...change.list.commands].map((command) => command.name);
  return [...new Set(names)].sort();
}

function commandChanges(change: ChangedList): readonly string[] {
  const names = commandNames(change);
  const changes = names.flatMap((name) => {
    const found = commandChange(
      commandNamed(change.given.list.commands, name),
      commandNamed(change.list.commands, name),
    );
    return found === undefined ? [] : [{ name, found }];
  });
  const table = { marked: true, nameWidth: nameWidthOf(changes.map(({ name }) => name)) };
  return changes.flatMap(({ found }) => rowLines(table, found.marker, found.segments));
}

function folderChanges(change: ChangedList): readonly string[] {
  const before = change.given.list.throwaway;
  const now = change.list.throwaway;
  const added = now.filter((folder) => !before.includes(folder)).map((folder) => ["+", folder] as const);
  const removed = before.filter((folder) => !now.includes(folder)).map((folder) => ["-", folder] as const);
  return [...added, ...removed].flatMap(([marker, folder]) =>
    hanging([marker, "folder", shown(folder)], { first: "  ", rest: "    " }),
  );
}

function stayedLine(change: ChangedList): readonly string[] {
  const names = commandNames(change).filter((name) => {
    const before = commandNamed(change.given.list.commands, name);
    const now = commandNamed(change.list.commands, name);
    return before !== undefined && now !== undefined && commandChange(before, now) === undefined;
  });
  const folders = change.list.throwaway.filter((folder) => change.given.list.throwaway.includes(folder));
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
  return [
    ...paragraph(`The mode ${shown(list.mode)} changed its list.`),
    ...paragraph(`${trustedWhen(given)} None of it runs until you decide.`),
    "",
    ...commandChanges(change),
    ...folderChanges(change),
    ...stayedLine(change),
    "",
    ...paragraph(scriptsSentence(change.changedScripts)),
    "",
    hashLine(listHashOf(list)),
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
