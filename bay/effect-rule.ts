import type { Resource, RefusalWording } from "./answers.ts";
import type { Effect, Permissions } from "./contracts.ts";
import type { HttpRequest } from "./ports.ts";
import { leadingKeyword, statementWords, writeKeywords } from "./sql-statements.ts";

export type SpendAmounts = {
  readonly items: number;
  readonly usd: number;
  readonly tokens: number;
};

export type BrokerOperation =
  | { readonly kind: "db.migrate" }
  | { readonly kind: "db.execute"; readonly sql: string }
  | { readonly kind: "db.query"; readonly sql: string }
  | { readonly kind: "db.agentQuery" }
  | { readonly kind: "files.read"; readonly path: string }
  | { readonly kind: "files.list"; readonly path: string }
  | { readonly kind: "files.write"; readonly path: string }
  | { readonly kind: "secrets.get"; readonly name: string }
  | { readonly kind: "http.request"; readonly method: HttpRequest["method"]; readonly url: string }
  | { readonly kind: "events.emit"; readonly eventKind: string }
  | { readonly kind: "spend"; readonly amounts: SpendAmounts };

export type ActionAt = {
  readonly stepKey: string;
  readonly action: string;
  readonly manifest: string;
};

type Need = {
  readonly effect: Effect;
  readonly because: string;
};

const deletingWords: readonly string[] = ["delete", "drop", "truncate"];

const changesData: Need = { effect: "write", because: "A statement that changes data needs the write effect" };

const deletesData: Need = { effect: "delete", because: "A statement that deletes needs the delete effect" };

const writesFiles: Need = { effect: "write", because: "Writing a file needs the write effect" };

const usesNetwork: Need = { effect: "network", because: "A request over the network needs the network effect" };

const spends: Need = { effect: "spend", because: "Spending more than nothing needs the spend effect" };

export function deletes(sql: string): boolean {
  return statementWords(sql).some((word) => deletingWords.includes(word));
}

function statementNeeds(sql: string): readonly Need[] {
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
  "db.migrate": { resource: "db", needs: [] },
  "db.execute": { resource: "db", needs: [] },
  "db.query": { resource: "db", needs: [] },
  "db.agentQuery": { resource: "db", needs: [] },
  "files.read": { resource: "files", needs: [] },
  "files.list": { resource: "files", needs: [] },
  "files.write": { resource: "files", needs: [writesFiles] },
  "secrets.get": { resource: "secrets", needs: [] },
  "http.request": { resource: "http", needs: [usesNetwork] },
  "events.emit": { resource: "events", needs: [] },
  spend: { resource: "spend", needs: [] },
};

function contentNeeds(operation: BrokerOperation): readonly Need[] {
  if (operation.kind === "db.execute" || operation.kind === "db.query") {
    return statementNeeds(operation.sql);
  }
  if (operation.kind === "spend") {
    return isSpending(operation.amounts) ? [spends] : [];
  }
  return [];
}

function needsOf(operation: BrokerOperation): readonly Need[] {
  return [...operationRules[operation.kind].needs, ...contentNeeds(operation)];
}

type DatabaseOperation = Extract<BrokerOperation, { readonly kind: `db.${string}` }>;

function isDatabaseOperation(operation: BrokerOperation): operation is DatabaseOperation {
  return operationRules[operation.kind].resource === "db";
}

function describedDatabaseOperation(operation: DatabaseOperation): string {
  switch (operation.kind) {
    case "db.migrate":
      return "run the migrations";
    case "db.execute":
    case "db.query":
      return `run a statement that starts with "${leadingKeyword(operation.sql)}"`;
    case "db.agentQuery":
      return "run an agent's query";
  }
}

export function describedOperation(operation: BrokerOperation): string {
  if (isDatabaseOperation(operation)) {
    return describedDatabaseOperation(operation);
  }
  switch (operation.kind) {
    case "files.read":
    case "files.list":
    case "files.write":
      return `${operation.kind.slice("files.".length)} ${operation.path}`;
    case "secrets.get":
      return `get the secret ${operation.name}`;
    case "http.request":
      return `send a ${operation.method} request to ${operation.url}`;
    case "events.emit":
      return `emit an event of the kind ${operation.eventKind}`;
    case "spend":
      return `report spending ${JSON.stringify(operation.amounts)}`;
  }
}

export function effectRefusal(
  operation: BrokerOperation,
  effects: readonly Effect[],
  at: ActionAt,
): RefusalWording | undefined {
  const missing = needsOf(operation).find((need) => !effects.includes(need.effect));
  if (missing === undefined) {
    return undefined;
  }
  const declared = effects.length === 0 ? "none" : effects.join(", ");
  return {
    resource: operationRules[operation.kind].resource,
    asked: `The step ${at.stepKey} of action ${at.action} asked to ${describedOperation(operation)}`,
    declared: `the action ${at.action} declares the effects: ${declared}`,
    change: `${missing.because}; to allow it, add ${missing.effect} to actions.${at.action}.effects in ${at.manifest}.`,
  };
}

export function writableFolders(permissions: Permissions): readonly string[] {
  return permissions.actionEffects.includes(writesFiles.effect) ? permissions.grants.writePaths : [];
}

export function changesDataAllowed(effects: readonly Effect[]): boolean {
  return effects.includes(changesData.effect);
}
