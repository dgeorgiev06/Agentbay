import { dirname, join, resolve } from "node:path/posix";
import { type AgentQueryOutcome, runAgentQuery } from "./agent-query.ts";
import {
  type Answer,
  errorLine,
  failed,
  granted,
  listed,
  manifestOf,
  type RefusalWording,
  refused,
} from "../answers.ts";
import type { Json } from "../contracts.ts";
import type { DatabaseResult, Migration } from "./database.ts";
import { isInsideOrEqual, shownPath } from "../layout.ts";
import { type OperationName, type Reading, shapes } from "./operations.ts";
import {
  allowedWith,
  answered,
  type Asking,
  askingSentence,
  type Definition,
  type Doing,
  type Entries,
  type EntryRequests,
  type Need,
  noRefusalDetail,
  refusedWith,
  type Ruling,
  type Step,
} from "./rule.ts";
import type { AgentQueryResult, SqlParameters } from "../sdk.ts";
import { leadingKeyword, readKeywords, statementWords, writeKeywords } from "./sql-statements.ts";

type DatabaseOperationName = Extract<OperationName, `db.${string}`>;

const deletingWords: readonly string[] = ["delete", "drop", "truncate"];

const changesData: Need = { effect: "write", because: "A statement that changes data needs the write effect" };

const deletesData: Need = { effect: "delete", because: "A statement that deletes needs the delete effect" };

const migrationName = /^\d{4}-[^/]+\.sql$/;

const partitionName = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const longestPartitionName = 64;

type LateRefusals = {
  readonly writesOnReadOnly: RefusalWording;
  readonly severalStatements: RefusalWording;
  readonly missing: string;
};

type MigrationPlan = {
  readonly file: string;
  readonly folder: string;
  readonly shownFolder: string;
  readonly late: LateRefusals;
};

type StatementToRun = {
  readonly file: string;
  readonly sql: string;
  readonly parameters: SqlParameters;
  readonly migrateFirst: MigrationPlan | undefined;
  readonly late: LateRefusals;
};

type ChangeToRun = StatementToRun & { readonly writable: boolean };

type AgentQueryToRun = {
  readonly file: string;
  readonly sql: string;
  readonly migrateFirst: MigrationPlan | undefined;
  readonly missing: string;
};

function deletes(sql: string): boolean {
  return statementWords(sql).some((word) => deletingWords.includes(word));
}

function statementNeeds(sql: string): readonly Need[] {
  if (deletes(sql)) {
    return [changesData, deletesData];
  }
  return writeKeywords.includes(leadingKeyword(sql)) ? [changesData] : [];
}

function partitionFile(partition: string | undefined, asking: Asking): Ruling<string> {
  const databaseFile = asking.grants.databaseFile;
  if (partition === undefined) {
    return allowedWith(databaseFile);
  }
  if (partition.length > longestPartitionName || !partitionName.test(partition)) {
    return refusedWith({
      resource: "db",
      asked: `${askingSentence(asking)} for the database partition ${JSON.stringify(partition)}`,
      declared:
        `a partition name is kebab-case, at most ${String(longestPartitionName)} characters, ` +
        "with no dots or path separators",
      change: "Name the partition with lowercase letters, digits and single dashes, such as feed-briefing.",
    });
  }
  return allowedWith(join(dirname(databaseFile), `${asking.grants.mode}--${partition}.db`));
}

function missingDatabase(asking: Asking): string {
  return `The mode ${asking.grants.mode} has no database yet; run its migrations first.`;
}

function lateRefusals(keyword: string, asking: Asking): LateRefusals {
  const { action } = asking.at;
  return {
    writesOnReadOnly: {
      resource: "db",
      asked: `${askingSentence(asking)} in action ${action} to run a write statement (it starts with "${keyword}")`,
      declared: `the action ${action} declares the effects: ${listed(asking.effects, "none")}`,
      change: `To allow it, add write to actions.${action}.effects in ${manifestOf(asking.grants)}.`,
    },
    severalStatements: {
      resource: "db",
      asked: `${askingSentence(asking)} to run more than one statement in one call`,
      declared: "the broker runs exactly one statement per call",
      change: "Send each statement in its own call.",
    },
    missing: missingDatabase(asking),
  };
}

function migrationPlan(file: string, asking: Asking): Ruling<MigrationPlan> {
  const { grants } = asking;
  const folder = resolve(grants.modeFolder, grants.migrationsFolder);
  if (!isInsideOrEqual(folder, grants.modeFolder)) {
    return refusedWith({
      resource: "db",
      asked: `${askingSentence(asking)} to run the migrations in ${folder}`,
      declared: `migrations must lie inside the mode's folder ${grants.modeFolder}`,
      change: `Point resources.db.migrations in ${manifestOf(grants)} at a folder of the mode.`,
    });
  }
  const shownFolder = shownPath(asking.layout, folder);
  return allowedWith({ file, folder, shownFolder, late: lateRefusals("migrate", asking) });
}

function migrationFirst(partition: string | undefined, asking: Asking): Ruling<MigrationPlan | undefined> {
  return partition === undefined ? migrationPlan(asking.grants.databaseFile, asking) : allowedWith(undefined);
}

function statementRefusal(keyword: string, allowed: readonly string[], asking: Asking): Ruling<never> {
  return refusedWith({
    resource: "db",
    asked: `${askingSentence(asking)} to run a statement that starts with "${keyword}"`,
    declared: `this call runs only ${allowed.join(", ")} statements on the mode's own database`,
    change: "No manifest line allows attach, detach, vacuum, pragma or transaction statements; use plain SQL.",
  });
}

function statementRule(
  request: EntryRequests["db.query"],
  allowedKeywords: readonly string[],
  asking: Asking,
): Ruling<StatementToRun> {
  const file = partitionFile(request.partition, asking);
  if (!file.allowed) {
    return file;
  }
  const keyword = leadingKeyword(request.sql);
  if (!allowedKeywords.includes(keyword)) {
    return statementRefusal(keyword, allowedKeywords, asking);
  }
  const migrateFirst = migrationFirst(request.partition, asking);
  if (!migrateFirst.allowed) {
    return migrateFirst;
  }
  return allowedWith({
    file: file.value,
    sql: request.sql,
    parameters: request.parameters,
    migrateFirst: migrateFirst.value,
    late: lateRefusals(keyword, asking),
  });
}

function databaseAnswer<T>(
  result: DatabaseResult<Json>,
  reads: (value: Json) => Reading<T>,
  late: LateRefusals,
): Answer<T> {
  switch (result.status) {
    case "done": {
      const value = reads(result.value);
      return value.ok ? granted(value.value) : failed("The database process gave an answer of the wrong shape.");
    }
    case "missing":
      return failed(late.missing);
    case "writes-on-read-only":
      return refused(late.writesOnReadOnly);
    case "several-statements":
      return refused(late.severalStatements);
    case "error":
      return failed(`The statement failed: ${result.message}`);
  }
}

async function migrationsIn(plan: MigrationPlan, doing: Doing): Promise<Answer<readonly Migration[]>> {
  try {
    const names = (await doing.files.list(plan.folder)).filter((name) => name.endsWith(".sql"));
    const misnamed = names.filter((name) => !migrationName.test(name));
    if (misnamed.length > 0) {
      return failed(`Migration files are named NNNN-name.sql; rename ${misnamed.join(", ")}.`);
    }
    const ordered: Migration[] = [];
    for (const name of names.sort()) {
      ordered.push({ name, sql: (await doing.files.readText(`${plan.folder}/${name}`)) ?? "" });
    }
    return granted(ordered);
  } catch (error) {
    return failed(`The broker could not read the migrations in ${plan.shownFolder}: ${errorLine(error)}`);
  }
}

async function migrated(plan: MigrationPlan, doing: Doing): Promise<Answer<readonly string[]>> {
  const ordered = await migrationsIn(plan, doing);
  if (!ordered.ok) {
    return ordered;
  }
  if (ordered.value.length === 0 && !(await doing.files.exists(plan.file))) {
    return granted([]);
  }
  const appliedAt = doing.clock.now().toISOString();
  const order = { method: "migrate" as const, migrations: ordered.value, appliedAt };
  const result = await doing.databaseOf(plan.file).request(order);
  return databaseAnswer(result, shapes["db.migrate"].result, plan.late);
}

function migratedFirst(plan: MigrationPlan | undefined, doing: Doing): Promise<Answer<readonly string[]>> {
  if (plan === undefined) {
    return Promise.resolve(granted([]));
  }
  return doing.migratedOnce(() => migrated(plan, doing));
}

function redactedParameters(parameters: SqlParameters, redact: (text: string) => string): SqlParameters {
  const redacted = (value: Json): Json => (typeof value === "string" ? redact(value) : value);
  if (Array.isArray(parameters)) {
    return parameters.map(redacted);
  }
  return Object.fromEntries(Object.entries(parameters).map(([name, value]) => [name, redacted(value)]));
}

async function storedParameters(parameters: SqlParameters, doing: Doing): Promise<SqlParameters> {
  const stored = redactedParameters(parameters, (text) => doing.scrubber.redact(text));
  if (JSON.stringify(stored) !== JSON.stringify(parameters)) {
    await doing.record("redacted", {
      step: doing.stepKey,
      message: "Text that looks like a secret was removed from the values of a statement before it was stored.",
    });
  }
  return stored;
}

function redactedResult(result: AgentQueryResult, doing: Doing): AgentQueryResult {
  const longest = doing.limits.agentQueryCellCharacters;
  const shown = (cell: Json): Json => {
    const redacted = doing.scrubber.redactJson(cell);
    if (typeof redacted !== "string" || redacted.length <= longest) {
      return redacted;
    }
    const cut = String(redacted.length - longest);
    return `${redacted.slice(0, longest)}…[cut ${cut} characters; select less with substr()]`;
  };
  return { columns: result.columns, rows: result.rows.map((row) => row.map(shown)) };
}

function agentQueryAnswer(outcome: AgentQueryOutcome, doing: Doing): Answer<AgentQueryResult> {
  const rows = String(doing.limits.agentQueryRows);
  const milliseconds = String(doing.limits.agentQueryMilliseconds);
  const rules =
    "agent queries run one read-only select over the mode's own database, where every table is readable, " +
    `return at most ${rows} rows and stop at the time limit of ${milliseconds} ms`;
  const change = "Send one select statement, narrowed with where, limit or an aggregate.";
  switch (outcome.status) {
    case "done":
      return granted(redactedResult(outcome.value, doing));
    case "refused":
      return refused({
        resource: "db",
        asked: `An agent's query was refused (${outcome.reason})`,
        declared: rules,
        change,
      });
    case "timed-out":
      return refused({
        resource: "db",
        asked: "An agent's query was still running and was killed",
        declared: rules,
        change,
      });
    case "failed":
      return failed(outcome.message);
  }
}

function statementDescribed(request: { readonly sql: string }): string {
  return `run a statement that starts with "${leadingKeyword(request.sql)}"`;
}

const dbExecute: Definition<"db.execute", ChangeToRun> = {
  operation: "db.execute",
  needs: (request) => statementNeeds(request.sql),
  described: statementDescribed,
  rule: (request, asking) => {
    const statement = statementRule(request, [...readKeywords, ...writeKeywords], asking);
    const writable = asking.effects.includes(changesData.effect);
    return Promise.resolve(statement.allowed ? allowedWith({ ...statement.value, writable }) : statement);
  },
  handler: async (change, doing) => {
    const ready = await migratedFirst(change.migrateFirst, doing);
    if (!ready.ok) {
      return ready;
    }
    const parameters = await storedParameters(change.parameters, doing);
    const order = { method: "execute" as const, sql: change.sql, parameters, writable: change.writable };
    const result = await doing.databaseOf(change.file).request(order);
    return databaseAnswer(result, shapes["db.execute"].result, change.late);
  },
  refusalDetail: noRefusalDetail,
};

const dbQuery: Definition<"db.query", StatementToRun> = {
  operation: "db.query",
  needs: (request) => statementNeeds(request.sql),
  described: statementDescribed,
  rule: (request, asking) => Promise.resolve(statementRule(request, readKeywords, asking)),
  handler: async (statement, doing) => {
    const ready = await migratedFirst(statement.migrateFirst, doing);
    if (!ready.ok) {
      return ready;
    }
    const order = { method: "query" as const, sql: statement.sql, parameters: statement.parameters };
    const result = await doing.databaseOf(statement.file).request(order);
    return databaseAnswer(result, shapes["db.query"].result, statement.late);
  },
  refusalDetail: noRefusalDetail,
};

const dbMigrate: Definition<"db.migrate", MigrationPlan> = {
  operation: "db.migrate",
  needs: () => [],
  described: () => "run the migrations",
  rule: (request, asking) => {
    const file = partitionFile(request.partition, asking);
    return Promise.resolve(file.allowed ? migrationPlan(file.value, asking) : file);
  },
  handler: (plan, doing) => migrated(plan, doing),
  refusalDetail: noRefusalDetail,
};

const dbAgentQuery: Definition<"db.agentQuery", AgentQueryToRun> = {
  operation: "db.agentQuery",
  needs: () => [],
  described: () => "run an agent's query",
  rule: (request, asking) => {
    const file = partitionFile(request.partition, asking);
    if (!file.allowed) {
      return Promise.resolve(file);
    }
    const migrateFirst = migrationFirst(request.partition, asking);
    if (!migrateFirst.allowed) {
      return Promise.resolve(migrateFirst);
    }
    const missing = missingDatabase(asking);
    return Promise.resolve(
      allowedWith({ file: file.value, sql: request.sql, migrateFirst: migrateFirst.value, missing }),
    );
  },
  handler: async (query, doing) => {
    const ready = await migratedFirst(query.migrateFirst, doing);
    if (!ready.ok) {
      return ready;
    }
    if (!(await doing.files.exists(query.file))) {
      return failed(query.missing);
    }
    const limits = {
      rows: doing.limits.agentQueryRows,
      resultBytes: doing.limits.agentQueryResultBytes,
      milliseconds: doing.limits.agentQueryMilliseconds,
    };
    const outcome = await runAgentQuery(doing.childProcesses, { databaseFile: query.file, sql: query.sql, limits });
    return agentQueryAnswer(outcome, doing);
  },
  refusalDetail: noRefusalDetail,
};

export function databaseEntries(step: Step): Entries<DatabaseOperationName> {
  return {
    "db.execute": (request) => answered(dbExecute, request, step),
    "db.query": (request) => answered(dbQuery, request, step),
    "db.migrate": (request) => answered(dbMigrate, request, step),
    "db.agentQuery": (request) => answered(dbAgentQuery, request, step),
  };
}
