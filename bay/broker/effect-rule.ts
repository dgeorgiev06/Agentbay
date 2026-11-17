import { listed, type Resource, type RefusalWording } from "../answers.ts";
import type { Effect, Permissions } from "../contracts.ts";
import type { HttpRequest } from "../sdk.ts";
import { leadingKeyword, statementWords, writeKeywords } from "./sql-statements.ts";

export type SpendAmounts = {
  readonly items: number;
  readonly usd: number;
  readonly tokens: number;
};

export type BrokerOperation =
  | { readonly kind: "secrets.get"; readonly name: string }
  | { readonly kind: "http.request"; readonly method: HttpRequest["method"]; readonly url: string }
  | { readonly kind: "events.emit"; readonly eventKind: string }
  | { readonly kind: "spend"; readonly amounts: SpendAmounts }
  | { readonly kind: "skill.submit"; readonly usd: number }
  | { readonly kind: "commands.run"; readonly command: readonly string[]; readonly folder: string };

export type CommandOperation = Extract<BrokerOperation, { readonly kind: "commands.run" }>;

export type ActionAt = {
  readonly stepKey: string;
  readonly action: string;
  readonly manifest: string;
};

export type Need = {
  readonly effect: Effect;
  readonly because: string;
};

export type Needing = {
  readonly resource: Resource;
  readonly doing: string;
  readonly needs: readonly Need[];
};

const deletingWords: readonly string[] = ["delete", "drop", "truncate"];

const everyEffect: readonly Effect[] = ["read", "write", "network", "spend", "delete"];

const changesData: Need = { effect: "write", because: "A statement that changes data needs the write effect" };

const deletesData: Need = { effect: "delete", because: "A statement that deletes needs the delete effect" };

export const writesFiles: Need = { effect: "write", because: "Writing a file needs the write effect" };

export const removesFiles: Need = { effect: "delete", because: "Removing a file or folder needs the delete effect" };

const usesNetwork: Need = { effect: "network", because: "A request over the network needs the network effect" };

const spends: Need = { effect: "spend", because: "Spending more than nothing needs the spend effect" };

const reportsDollars: Need = { effect: "spend", because: "Reporting dollars an agent spent needs the spend effect" };

const runsCommands: readonly Need[] = everyEffect.map((effect) => ({
  effect,
  because: "A command can do anything its program can, so running one needs all five effects",
}));

function deletes(sql: string): boolean {
  return statementWords(sql).some((word) => deletingWords.includes(word));
}

export function statementNeeds(sql: string): readonly Need[] {
  if (deletes(sql)) {
    return [changesData, deletesData];
  }
  return writeKeywords.includes(leadingKeyword(sql)) ? [changesData] : [];
}

function isSpending(amounts: SpendAmounts): boolean {
  return amounts.items > 0 || amounts.usd > 0 || amounts.tokens > 0;
}

type OperationRule = {
  readonly resource: Resource;
  readonly needs: readonly Need[];
};

const operationRules: { readonly [Kind in BrokerOperation["kind"]]: OperationRule } = {
  "secrets.get": { resource: "secrets", needs: [] },
  "http.request": { resource: "http", needs: [usesNetwork] },
  "events.emit": { resource: "events", needs: [] },
  spend: { resource: "spend", needs: [] },
  "skill.submit": { resource: "spend", needs: [] },
  "commands.run": { resource: "commands", needs: runsCommands },
};

function contentNeeds(operation: BrokerOperation): readonly Need[] {
  if (operation.kind === "spend") {
    return isSpending(operation.amounts) ? [spends] : [];
  }
  if (operation.kind === "skill.submit") {
    return operation.usd > 0 ? [reportsDollars] : [];
  }
  return [];
}

function needsOf(operation: BrokerOperation): readonly Need[] {
  return [...operationRules[operation.kind].needs, ...contentNeeds(operation)];
}

type SpendingOperation = Extract<BrokerOperation, { readonly kind: "spend" | "skill.submit" }>;

function isSpendingOperation(operation: BrokerOperation): operation is SpendingOperation {
  return operationRules[operation.kind].resource === "spend";
}

function describedSpending(operation: SpendingOperation): string {
  return operation.kind === "spend"
    ? `report spending ${JSON.stringify(operation.amounts)}`
    : `report spending ${String(operation.usd)} US dollars`;
}

export function describedOperation(operation: BrokerOperation): string {
  if (isSpendingOperation(operation)) {
    return describedSpending(operation);
  }
  switch (operation.kind) {
    case "secrets.get":
      return `get the secret ${operation.name}`;
    case "http.request":
      return `send a ${operation.method} request to ${operation.url}`;
    case "events.emit":
      return `emit an event of the kind ${operation.eventKind}`;
    case "commands.run":
      return `run the command ${JSON.stringify(operation.command)} in ${operation.folder}`;
  }
}

function askedTo(doing: string, at: ActionAt): string {
  return `The step ${at.stepKey} of action ${at.action} asked to ${doing}`;
}

export function askedSentence(operation: BrokerOperation, at: ActionAt): string {
  return askedTo(describedOperation(operation), at);
}

export function missingEffectRefusal(
  needing: Needing,
  effects: readonly Effect[],
  at: ActionAt,
): RefusalWording | undefined {
  const missing = needing.needs.find((need) => !effects.includes(need.effect));
  if (missing === undefined) {
    return undefined;
  }
  const declared = effects.length === 0 ? "none" : effects.join(", ");
  return {
    resource: needing.resource,
    asked: askedTo(needing.doing, at),
    declared: `the action ${at.action} declares the effects: ${declared}`,
    change: `${missing.because}; to allow it, add ${missing.effect} to actions.${at.action}.effects in ${at.manifest}.`,
  };
}

export function effectRefusal(
  operation: BrokerOperation,
  effects: readonly Effect[],
  at: ActionAt,
): RefusalWording | undefined {
  const needing = {
    resource: operationRules[operation.kind].resource,
    doing: describedOperation(operation),
    needs: needsOf(operation),
  };
  return missingEffectRefusal(needing, effects, at);
}

export function writableFolders(permissions: Permissions): readonly string[] {
  return permissions.actionEffects.includes(writesFiles.effect) ? permissions.grants.writePaths : [];
}

export function grantedCommands(permissions: Permissions): readonly string[] {
  const declaresEvery = runsCommands.every((need) => permissions.actionEffects.includes(need.effect));
  return declaresEvery ? permissions.grants.commands : [];
}

function argumentsOf(prefix: string): readonly string[] {
  return prefix.split(/\s+/).filter((argument) => argument !== "");
}

function startsWithPrefix(command: readonly string[], prefix: string): boolean {
  const leading = argumentsOf(prefix);
  return leading.length > 0 && leading.every((argument, index) => command[index] === argument);
}

export function commandRefusal(
  operation: CommandOperation,
  prefixes: readonly string[],
  at: ActionAt,
): RefusalWording | undefined {
  if (prefixes.some((prefix) => startsWithPrefix(operation.command, prefix))) {
    return undefined;
  }
  return {
    resource: "commands",
    asked: askedSentence(operation, at),
    declared:
      `its mode lists the commands: ${listed(prefixes, "none")}, ` +
      "and a command must start with one of them, argument by argument",
    change:
      `To allow it, add the command's leading arguments under resources.commands in ${at.manifest}; ` +
      "only a mode under the kit's components/base/ may list commands.",
  };
}

export function mayRemoveFiles(permissions: Permissions): boolean {
  return writableFolders(permissions).length > 0 && permissions.actionEffects.includes(deletesData.effect);
}

export function changesDataAllowed(effects: readonly Effect[]): boolean {
  return effects.includes(changesData.effect);
}
