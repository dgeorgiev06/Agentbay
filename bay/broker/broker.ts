import { createHash } from "node:crypto";
import { basename, dirname, join, resolve } from "node:path/posix";
import { type AgentQueryOutcome, type AgentQueryResult, runAgentQuery } from "./agent-query.ts";
import { type Answer, errorLine, failed, granted, listed, manifestOf, refused } from "../answers.ts";
import type {
  ChildProcesses,
  Clock,
  FileInspector,
  FileSystem,
  Http,
  HttpRequest,
  HttpResponse,
  ProcessOutput,
  Processes,
  ThrowawayFolders,
} from "../ports.ts";
import type {
  CommandOutput,
  CommandRan,
  CommandRequest,
  Effect,
  EventSink,
  Json,
  ModeGrants,
  Permissions,
  StepPlace,
} from "../contracts.ts";
import type { DatabaseResult, ExecuteResult, Migration, Row, SqlParameters } from "./database.ts";
import { DatabaseProcess } from "./database-process.ts";
import {
  type ActionAt,
  askedSentence,
  type CommandOperation,
  describedOperation,
  commandRefusal,
  effectRefusal,
  type BrokerOperation,
  changesDataAllowed,
  type SpendAmounts,
} from "./effect-rule.ts";
import { checkPath, type PathCheck, type Purpose } from "./file-access.ts";
import { checkUrl, type Hop, loggedHeaders, nextRequest, redirectTarget, type UrlCheck } from "./http-access.ts";
import { isInsideOrEqual, pathIn, shownPath, type Layout } from "../layout.ts";
import type { SecretStore } from "../secrets.ts";
import { isJsonRecord } from "../protocol-json.ts";
import { leadingKeyword, readKeywords, writeKeywords } from "./sql-statements.ts";

export type BrokerLimits = {
  readonly agentQueryRows: number;
  readonly agentQueryCellCharacters: number;
  readonly agentQueryResultBytes: number;
  readonly agentQueryMilliseconds: number;
  readonly httpRequestBytes: number;
  readonly httpResponseBytes: number;
  readonly httpRedirects: number;
  readonly databaseMilliseconds: number;
  readonly commandMilliseconds: number;
  readonly commandOutputCharacters: number;
};

export type BrokerOptions = {
  readonly layout: Layout;
  readonly permissions: Permissions;
  readonly place: StepPlace;
  readonly files: FileSystem;
  readonly throwawayFolders: ThrowawayFolders;
  readonly inspector: FileInspector;
  readonly http: Http;
  readonly secrets: SecretStore;
  readonly events: EventSink;
  readonly clock: Clock;
  readonly childProcesses: ChildProcesses;
  readonly processes: Processes;
  readonly commandSearchPath: string;
  readonly limits?: Partial<BrokerLimits>;
};

const defaultBrokerLimits: BrokerLimits = {
  agentQueryRows: 200,
  agentQueryCellCharacters: 4000,
  agentQueryResultBytes: 1_000_000,
  agentQueryMilliseconds: 2000,
  httpRequestBytes: 1024 * 1024,
  httpResponseBytes: 10 * 1024 * 1024,
  httpRedirects: 5,
  databaseMilliseconds: 10 * 60 * 1000,
  commandMilliseconds: 10 * 60 * 1000,
  commandOutputCharacters: 64 * 1024,
};

const dataFolder = ".agentbay";

type ThrowawayOperation = Extract<
  BrokerOperation,
  { readonly kind: "files.makeFolder" | "files.link" | "files.remove" }
>;

type ThrowawayPlace = {
  readonly path: string;
  readonly checked: "itself" | "folder";
};

const migrationName = /^\d{4}-[^/]+\.sql$/;

const partitionName = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

const longestPartitionName = 64;

const brokerKinds: readonly string[] = ["refused", "http", "redacted", "command", "throwaway"];

const isRows = (value: Json): value is readonly Row[] =>
  Array.isArray(value) && value.every((row: Json) => isJsonRecord(row));

const isExecuteResult = (value: Json): value is ExecuteResult =>
  isJsonRecord(value) && typeof value.changes === "number" && typeof value.lastInsertRowid === "number";

const isNames = (value: Json): value is readonly string[] =>
  Array.isArray(value) && value.every((name: Json) => typeof name === "string");

type Expected<T> = {
  readonly keyword: string;
  readonly fits: (value: Json) => value is Json & T;
};

function redactedParameters(parameters: SqlParameters, redact: (text: string) => string): SqlParameters {
  const redacted = (value: Json): Json => (typeof value === "string" ? redact(value) : value);
  if (Array.isArray(parameters)) {
    return parameters.map(redacted);
  }
  return Object.fromEntries(Object.entries(parameters).map(([name, value]) => [name, redacted(value)]));
}

const noAmounts: SpendAmounts = { items: 0, usd: 0, tokens: 0 };

const spendMeasures = ["items", "usd", "tokens"] as const;

function isAmount(value: Json | undefined): boolean {
  return value === undefined || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function amountOf(value: Json | undefined): number {
  return typeof value === "number" ? value : 0;
}

function spendAmountsOf(spending: Json): SpendAmounts | undefined {
  if (!isJsonRecord(spending) || !spendMeasures.every((measure) => isAmount(spending[measure]))) {
    return undefined;
  }
  return { items: amountOf(spending.items), usd: amountOf(spending.usd), tokens: amountOf(spending.tokens) };
}

function spendingRefusal(spending: Json): Answer<never> {
  return refused({
    resource: "spend",
    asked: `The step reported the spending ${JSON.stringify(spending)}`,
    declared: "spending is given as items, usd and tokens, each a number of at least 0",
    change: "Report spending as { items, usd, tokens } with numbers of at least 0.",
  });
}

export class Broker {
  readonly #options: BrokerOptions;
  readonly #grants: ModeGrants;
  readonly #effects: readonly Effect[];
  readonly #limits: BrokerLimits;
  readonly #databases = new Map<string, DatabaseProcess>();
  #unnamedMigration: Promise<Answer<readonly string[]>> | undefined;

  constructor(options: BrokerOptions) {
    this.#options = options;
    this.#grants = options.permissions.grants;
    this.#effects = options.permissions.actionEffects;
    this.#limits = { ...defaultBrokerLimits, ...options.limits };
  }

  #partitionFile(partition: string | undefined): Answer<string> {
    const databaseFile = this.#grants.databaseFile;
    if (partition === undefined) {
      return granted(databaseFile);
    }
    if (partition.length > longestPartitionName || !partitionName.test(partition)) {
      return refused({
        resource: "db",
        asked: `${this.#asking} for the database partition ${JSON.stringify(partition)}`,
        declared:
          `a partition name is kebab-case, at most ${String(longestPartitionName)} characters, ` +
          "with no dots or path separators",
        change: "Name the partition with lowercase letters, digits and single dashes, such as feed-briefing.",
      });
    }
    return granted(join(dirname(databaseFile), `${this.#grants.mode}--${partition}.db`));
  }

  migrate(partition?: string): Promise<Answer<readonly string[]>> {
    return this.#guarded({ kind: "db.migrate" }, () => this.#migrateNow(partition));
  }

  execute(sql: string, parameters: SqlParameters = [], partition?: string): Promise<Answer<ExecuteResult>> {
    return this.#guarded({ kind: "db.execute", sql }, async () => {
      const file = this.#partitionFile(partition);
      if (!file.ok) {
        return file;
      }
      const keyword = leadingKeyword(sql);
      if (![...readKeywords, ...writeKeywords].includes(keyword)) {
        return this.#statementRefusal(keyword, [...readKeywords, ...writeKeywords]);
      }
      const migrated = await this.#migratedFirst(partition);
      if (!migrated.ok) {
        return migrated;
      }
      const writable = changesDataAllowed(this.#effects);
      const stored = await this.#storedParameters(parameters);
      const order = { method: "execute" as const, sql, parameters: stored, writable };
      const result = await this.#databaseOf(file.value).request(order);
      return this.#databaseAnswer(result, { keyword, fits: isExecuteResult });
    });
  }

  query(sql: string, parameters: SqlParameters = [], partition?: string): Promise<Answer<readonly Row[]>> {
    return this.#guarded({ kind: "db.query", sql }, async () => {
      const file = this.#partitionFile(partition);
      if (!file.ok) {
        return file;
      }
      const keyword = leadingKeyword(sql);
      if (!readKeywords.includes(keyword)) {
        return this.#statementRefusal(keyword, readKeywords);
      }
      const migrated = await this.#migratedFirst(partition);
      if (!migrated.ok) {
        return migrated;
      }
      const result = await this.#databaseOf(file.value).request({ method: "query", sql, parameters });
      return this.#databaseAnswer(result, { keyword, fits: isRows });
    });
  }

  agentQuery(sql: string, partition?: string): Promise<Answer<AgentQueryResult>> {
    return this.#guarded({ kind: "db.agentQuery" }, async () => {
      const file = this.#partitionFile(partition);
      if (!file.ok) {
        return file;
      }
      const migrated = await this.#migratedFirst(partition);
      if (!migrated.ok) {
        return migrated;
      }
      if (!(await this.#options.files.exists(file.value))) {
        return failed(`The mode ${this.#grants.mode} has no database yet; run its migrations first.`);
      }
      return this.#agentQueryAnswer(await this.#runAgentQuery(file.value, sql));
    });
  }

  readFile(path: string): Promise<Answer<string>> {
    return this.#guarded({ kind: "files.read", path: this.#shown(path) }, async () => {
      const checked = await this.#checkedPath(path, "read");
      if (!checked.ok) {
        return checked;
      }
      const text = await this.#options.files.readText(checked.value);
      return text === undefined ? failed(`The file ${checked.value} does not exist.`) : granted(text);
    });
  }

  writeFile(path: string, text: string): Promise<Answer<null>> {
    return this.#guarded({ kind: "files.write", path: this.#shown(path) }, async () => {
      const checked = await this.#checkedPath(path, "write");
      if (!checked.ok) {
        return checked;
      }
      const redacted = this.#options.secrets.redactKnownValues(text);
      if (redacted !== text) {
        await this.#append("redacted", {
          step: this.#options.place.stepKey,
          file: checked.value,
          message: "A secret's value was removed from the text before the file was written.",
        });
      }
      await this.#options.files.writeAtomic(checked.value, redacted);
      return granted(null);
    });
  }

  listFiles(path: string): Promise<Answer<readonly string[]>> {
    return this.#guarded({ kind: "files.list", path: this.#shown(path) }, async () => {
      const checked = await this.#checkedPath(path, "read");
      if (!checked.ok) {
        return checked;
      }
      return granted(await this.#options.files.list(checked.value));
    });
  }

  makeFolder(path: string): Promise<Answer<null>> {
    const operation = { kind: "files.makeFolder" as const, path: this.#shown(path) };
    return this.#throwawayChange(operation, { path, checked: "itself" }, async (full) => {
      if (await this.#isTaken(full)) {
        return failed(`The folder ${operation.path} already exists.`);
      }
      await this.#options.throwawayFolders.makeFolder(full);
      await this.#recordThrowaway({ did: "made the folder", path: operation.path });
      return granted(null);
    });
  }

  link(path: string, target: string): Promise<Answer<null>> {
    const operation = { kind: "files.link" as const, path: this.#shown(path), target: this.#shown(target) };
    return this.#throwawayChange(operation, { path, checked: "folder" }, async (full) => {
      const leadsTo = this.#linkTarget(operation, target);
      if (!leadsTo.ok) {
        return leadsTo;
      }
      if (await this.#isTaken(full)) {
        return failed(`The path ${operation.path} already exists.`);
      }
      await this.#options.throwawayFolders.link(full, leadsTo.value);
      await this.#recordThrowaway({ did: "made a link", path: operation.path, target: operation.target });
      return granted(null);
    });
  }

  remove(path: string): Promise<Answer<null>> {
    const operation = { kind: "files.remove" as const, path: this.#shown(path) };
    return this.#throwawayChange(operation, { path, checked: "folder" }, async (full) => {
      await this.#options.throwawayFolders.removeAll(full);
      await this.#recordThrowaway({ did: "removed", path: operation.path });
      return granted(null);
    });
  }

  secret(name: string): Promise<Answer<string>> {
    return this.#guarded({ kind: "secrets.get", name }, () => this.#options.secrets.get(name, this.#grants));
  }

  request(request: HttpRequest): Promise<Answer<HttpResponse>> {
    const operation = { kind: "http.request" as const, method: request.method, url: request.url };
    return this.#guarded(operation, () => this.#sendFollowingRedirects(request));
  }

  emit(kind: string, detail: Json): Promise<Answer<null>> {
    return this.#guarded({ kind: "events.emit", eventKind: kind }, async () => {
      if (brokerKinds.includes(kind)) {
        return refused({
          resource: "events",
          asked: `${this.#asking} to emit an event of the kind ${kind}`,
          declared: `the kinds ${brokerKinds.join(" and ")} are written only by the broker`,
          change: "Choose another kind for the event.",
        });
      }
      await this.#append(kind, detail);
      return granted(null);
    });
  }

  spend(spending: Json): Promise<Answer<SpendAmounts>> {
    const amounts = spendAmountsOf(spending);
    return this.#guarded({ kind: "spend", amounts: amounts ?? noAmounts }, () =>
      Promise.resolve(amounts === undefined ? spendingRefusal(spending) : granted(amounts)),
    );
  }

  runCommand(request: CommandRequest): Promise<Answer<CommandRan>> {
    const operation = { kind: "commands.run" as const, command: request.command, folder: request.folder };
    return this.#guarded(operation, async () => {
      const unlisted = commandRefusal(operation, this.#grants.commands, this.#at);
      if (unlisted !== undefined) {
        return refused(unlisted);
      }
      const milliseconds = this.#commandMilliseconds(operation, request.timeLimitSeconds);
      if (!milliseconds.ok) {
        return milliseconds;
      }
      const folder = await this.#commandFolder(operation);
      if (!folder.ok) {
        return folder;
      }
      return this.#ranCommand(request, folder.value, milliseconds.value);
    });
  }

  report<T>(answer: Answer<T>): Promise<Answer<T>> {
    return this.#settle(answer);
  }

  get #asking(): string {
    return `The step ${this.#options.place.stepKey} asked`;
  }

  get #at(): ActionAt {
    const place = this.#options.place;
    return { stepKey: place.stepKey, action: place.action, manifest: manifestOf(this.#grants) };
  }

  async #guarded<T>(operation: BrokerOperation, body: () => Promise<Answer<T>>): Promise<Answer<T>> {
    const refusal = effectRefusal(operation, this.#effects, this.#at);
    const recorded = operation.kind === "commands.run" ? { command: operation.command, folder: operation.folder } : {};
    try {
      return await this.#settle(refusal === undefined ? await body() : refused(refusal), recorded);
    } catch (error) {
      const doing = describedOperation(operation);
      return this.#settle(failed(`The step ${this.#at.stepKey} could not ${doing}: ${errorLine(error)}`));
    }
  }

  #commandMilliseconds(operation: CommandOperation, seconds: number): Answer<number> {
    if (Number.isFinite(seconds) && seconds > 0) {
      return granted(Math.min(seconds * 1000, this.#limits.commandMilliseconds));
    }
    return refused({
      resource: "commands",
      asked: `${askedSentence(operation, this.#at)} with a time limit of ${String(seconds)} seconds`,
      declared: "a command's time limit is a number of seconds above 0",
      change: "Give timeLimitSeconds as a number above 0 in the call to context.commands.run.",
    });
  }

  async #commandFolder(operation: CommandOperation): Promise<Answer<string>> {
    const { layout, inspector } = this.#options;
    const permitted = [layout.project];
    const check = await checkPath(inspector, { layout, path: operation.folder, permitted, purpose: "read" });
    const asked = askedSentence(operation, this.#at);
    const change =
      'Give a folder of the project in the call to context.commands.run, such as "."; no manifest line allows another.';
    if (check.status !== "allowed") {
      return refused({
        resource: "commands",
        asked,
        declared: "a command runs only in a folder inside the project",
        change,
      });
    }
    const real = await inspector.realPath(check.path);
    if (real === undefined) {
      return failed(`The folder ${shownPath(layout, check.path)} does not exist.`);
    }
    const data = pathIn(layout, "project", dataFolder);
    const realData = (await inspector.realPath(data)) ?? data;
    if (isInsideOrEqual(check.path, data) || isInsideOrEqual(real, realData)) {
      const declared = "a command never runs inside the kernel's state folder .agentbay/";
      return refused({ resource: "commands", asked, declared, change });
    }
    return granted(real);
  }

  async #ranCommand(request: CommandRequest, folder: string, milliseconds: number): Promise<Answer<CommandRan>> {
    const { command, input } = request;
    const [program, ...rest] = command;
    if (program === undefined) {
      return failed("The command is empty.");
    }
    const clock = this.#options.clock;
    const startedAt = clock.now().getTime();
    const result = await this.#options.processes.run({
      command: program,
      arguments: rest,
      directory: folder,
      environment: { PATH: this.#options.commandSearchPath },
      timeoutMilliseconds: milliseconds,
      ...(input === undefined ? {} : { input }),
    });
    const took = clock.now().getTime() - startedAt;
    await this.#append("command", {
      step: this.#options.place.stepKey,
      command,
      folder: shownPath(this.#options.layout, folder),
      end: result.end,
      milliseconds: took,
      ...(input === undefined ? {} : { inputHash: createHash("sha256").update(input, "utf8").digest("hex") }),
      stdoutHash: result.stdout.hash,
      stderrHash: result.stderr.hash,
    });
    if (result.end.how === "not-started") {
      return failed(`The command ${JSON.stringify(command)} could not start: ${result.end.reason}`);
    }
    return granted({
      end: result.end,
      milliseconds: took,
      stdout: this.#shownOutput(result.stdout),
      stderr: this.#shownOutput(result.stderr),
    });
  }

  #shownOutput(output: ProcessOutput): CommandOutput {
    const limit = this.#limits.commandOutputCharacters;
    const scrubbed = this.#options.secrets.redact(output.text);
    const cut = output.characters > output.text.length || scrubbed.length > limit;
    return { text: scrubbed.slice(-limit), cut };
  }

  #shown(path: string): string {
    return shownPath(this.#options.layout, resolve(this.#options.layout.project, path));
  }

  async #migrateNow(partition: string | undefined): Promise<Answer<readonly string[]>> {
    const file = this.#partitionFile(partition);
    if (!file.ok) {
      return file;
    }
    const migrations = resolve(this.#grants.modeFolder, this.#grants.migrationsFolder);
    if (!isInsideOrEqual(migrations, this.#grants.modeFolder)) {
      return refused({
        resource: "db",
        asked: `${this.#asking} to run the migrations in ${migrations}`,
        declared: `migrations must lie inside the mode's folder ${this.#grants.modeFolder}`,
        change: `Point resources.db.migrations in ${manifestOf(this.#grants)} at a folder of the mode.`,
      });
    }
    const ordered = await this.#migrationsIn(migrations);
    if (!ordered.ok) {
      return ordered;
    }
    if (ordered.value.length === 0 && !(await this.#options.files.exists(file.value))) {
      return granted([]);
    }
    const appliedAt = this.#options.clock.now().toISOString();
    const order = { method: "migrate" as const, migrations: ordered.value, appliedAt };
    const result = await this.#databaseOf(file.value).request(order);
    return this.#databaseAnswer(result, { keyword: "migrate", fits: isNames });
  }

  async #migrationsIn(migrations: string): Promise<Answer<readonly Migration[]>> {
    const shown = shownPath(this.#options.layout, migrations);
    try {
      const names = (await this.#options.files.list(migrations)).filter((name) => name.endsWith(".sql"));
      const misnamed = names.filter((name) => !migrationName.test(name));
      if (misnamed.length > 0) {
        return failed(`Migration files are named NNNN-name.sql; rename ${misnamed.join(", ")}.`);
      }
      const ordered: Migration[] = [];
      for (const name of names.sort()) {
        ordered.push({ name, sql: (await this.#options.files.readText(`${migrations}/${name}`)) ?? "" });
      }
      return granted(ordered);
    } catch (error) {
      return failed(`The broker could not read the migrations in ${shown}: ${errorLine(error)}`);
    }
  }

  #runAgentQuery(databaseFile: string, sql: string): Promise<AgentQueryOutcome> {
    const limits = this.#limits;
    return runAgentQuery(this.#options.childProcesses, {
      databaseFile,
      sql,
      limits: {
        rows: limits.agentQueryRows,
        resultBytes: limits.agentQueryResultBytes,
        milliseconds: limits.agentQueryMilliseconds,
      },
    });
  }

  #agentQueryAnswer(outcome: AgentQueryOutcome): Answer<AgentQueryResult> {
    const rows = String(this.#limits.agentQueryRows);
    const milliseconds = String(this.#limits.agentQueryMilliseconds);
    const rules =
      "agent queries run one read-only select over the mode's own database, where every table is readable, " +
      `return at most ${rows} rows and stop at the time limit of ${milliseconds} ms`;
    const change = "Send one select statement, narrowed with where, limit or an aggregate.";
    switch (outcome.status) {
      case "done":
        return granted(this.#redactedResult(outcome.value));
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

  async #sendFollowingRedirects(request: HttpRequest): Promise<Answer<HttpResponse>> {
    const size = Buffer.byteLength(request.body ?? "");
    if (size > this.#limits.httpRequestBytes) {
      return refused({
        resource: "http",
        asked: `${this.#asking} to send a request body of ${String(size)} bytes`,
        declared: `the broker sends at most ${String(this.#limits.httpRequestBytes)} bytes`,
        change: "Send a smaller body; no manifest line raises this cap.",
      });
    }
    let current = request;
    for (let hops = 0; hops <= this.#limits.httpRedirects; hops += 1) {
      const check = checkUrl(current.url, this.#grants.hosts);
      if (check.status !== "allowed") {
        return this.#urlRefusal(check, hops > 0);
      }
      const response = await this.#sendOnce(current);
      if (!response.ok) {
        return response;
      }
      const hop: Hop = { request: current, response: response.value };
      const target = redirectTarget(hop);
      if (target === undefined) {
        return this.#cappedResponse(response.value);
      }
      current = nextRequest(hop, target);
    }
    return failed(`The request was redirected more than ${String(this.#limits.httpRedirects)} times.`);
  }

  close(): void {
    for (const database of this.#databases.values()) {
      database.close();
    }
    this.#databases.clear();
  }

  #migratedFirst(partition: string | undefined): Promise<Answer<readonly string[]>> {
    if (partition !== undefined) {
      return Promise.resolve(granted([]));
    }
    this.#unnamedMigration ??= this.#migrateNow(undefined);
    return this.#unnamedMigration;
  }

  #databaseOf(file: string): DatabaseProcess {
    const known = this.#databases.get(file);
    if (known !== undefined) {
      return known;
    }
    const database = new DatabaseProcess({
      childProcesses: this.#options.childProcesses,
      databaseFile: file,
      lifetimeMilliseconds: this.#limits.databaseMilliseconds,
    });
    this.#databases.set(file, database);
    return database;
  }

  async #storedParameters(parameters: SqlParameters): Promise<SqlParameters> {
    const stored = redactedParameters(parameters, (text) => this.#options.secrets.redact(text));
    if (JSON.stringify(stored) !== JSON.stringify(parameters)) {
      await this.#append("redacted", {
        step: this.#options.place.stepKey,
        message: "Text that looks like a secret was removed from the values of a statement before it was stored.",
      });
    }
    return stored;
  }

  async #append(kind: string, detail: Json): Promise<void> {
    await this.#options.events.append({
      at: this.#options.clock.now().toISOString(),
      runId: this.#options.place.runId,
      kind,
      detail: this.#options.secrets.redactJson(detail),
    });
  }

  async #settle<T>(answer: Answer<T>, recorded: { readonly [key: string]: Json } = {}): Promise<Answer<T>> {
    if (answer.ok) {
      return answer;
    }
    const secrets = this.#options.secrets;
    const message = secrets.redact(answer.message);
    if (answer.kind === "failed") {
      return failed(message);
    }
    await this.#append("refused", {
      resource: answer.resource,
      step: this.#options.place.stepKey,
      message,
      ...recorded,
    });
    const asked = secrets.redact(answer.asked);
    return {
      ...answer,
      asked,
      declared: secrets.redact(answer.declared),
      change: secrets.redact(answer.change),
      message,
    };
  }

  #redactedResult(result: AgentQueryResult): AgentQueryResult {
    const secrets = this.#options.secrets;
    const longest = this.#limits.agentQueryCellCharacters;
    const shown = (cell: Json): Json => {
      const redacted = secrets.redactJson(cell);
      if (typeof redacted !== "string" || redacted.length <= longest) {
        return redacted;
      }
      const cut = String(redacted.length - longest);
      return `${redacted.slice(0, longest)}…[cut ${cut} characters; select less with substr()]`;
    };
    return { columns: result.columns, rows: result.rows.map((row) => row.map(shown)) };
  }

  #statementRefusal<T>(keyword: string, allowed: readonly string[]): Answer<T> {
    return refused({
      resource: "db",
      asked: `${this.#asking} to run a statement that starts with "${keyword}"`,
      declared: `this call runs only ${allowed.join(", ")} statements on the mode's own database`,
      change: "No manifest line allows attach, detach, vacuum, pragma or transaction statements; use plain SQL.",
    });
  }

  #databaseAnswer<T>(result: DatabaseResult<Json>, expected: Expected<T>): Answer<T> {
    const place = this.#options.place;
    const keyword = expected.keyword;
    switch (result.status) {
      case "done":
        return expected.fits(result.value)
          ? granted(result.value)
          : failed("The database process gave an answer of the wrong shape.");
      case "missing":
        return failed(`The mode ${this.#grants.mode} has no database yet; run its migrations first.`);
      case "writes-on-read-only":
        return refused({
          resource: "db",
          asked: `${this.#asking} in action ${place.action} to run a write statement (it starts with "${keyword}")`,
          declared: `the action ${place.action} declares the effects: ${listed(this.#effects, "none")}`,
          change: `To allow it, add write to actions.${place.action}.effects in ${manifestOf(this.#grants)}.`,
        });
      case "several-statements":
        return refused({
          resource: "db",
          asked: `${this.#asking} to run more than one statement in one call`,
          declared: "the broker runs exactly one statement per call",
          change: "Send each statement in its own call.",
        });
      case "error":
        return failed(`The statement failed: ${result.message}`);
    }
  }

  #throwawayChange(
    operation: ThrowawayOperation,
    place: ThrowawayPlace,
    change: (full: string) => Promise<Answer<null>>,
  ): Promise<Answer<null>> {
    return this.#guarded(operation, async () => {
      const checked = await this.#throwawayPlace(operation, place);
      return checked.ok ? change(checked.value) : checked;
    });
  }

  async #recordThrowaway(detail: { readonly did: string; readonly path: string; readonly target?: string }) {
    await this.#append("throwaway", { step: this.#options.place.stepKey, ...detail });
  }

  async #isTaken(path: string): Promise<boolean> {
    const inspector = this.#options.inspector;
    return (await inspector.realPath(path)) !== undefined || (await inspector.isLink(path));
  }

  #linkTarget(operation: ThrowawayOperation, target: string): Answer<string> {
    const layout = this.#options.layout;
    const full = resolve(layout.project, target);
    const data = pathIn(layout, "project", dataFolder);
    if (isInsideOrEqual(full, layout.project) && !isInsideOrEqual(full, data)) {
      return granted(full);
    }
    return refused({
      resource: "files",
      asked: `${this.#asking} to ${describedOperation(operation)}`,
      declared: `a link may lead only to a path of the project outside ${dataFolder}/`,
      change: "Link to a file or folder of the project instead.",
    });
  }

  #outsideThrowaway(asked: string): Answer<never> {
    const shown = this.#grants.throwawayPaths.map((folder) => shownPath(this.#options.layout, folder));
    return refused({
      resource: "files",
      asked,
      declared:
        `the mode ${this.#grants.mode} keeps throwaway folders only in: ${listed(shown, "nothing")}, ` +
        "and never removes one of them whole",
      change: `To allow it, name a folder that holds the path under resources.files.throwaway in ${manifestOf(this.#grants)}.`,
    });
  }

  async #throwawayPlace(operation: ThrowawayOperation, place: ThrowawayPlace): Promise<Answer<string>> {
    const layout = this.#options.layout;
    const full = resolve(layout.project, place.path);
    const permitted = this.#grants.throwawayPaths;
    const asked = `${this.#asking} to ${describedOperation(operation)}`;
    if (!permitted.some((folder) => full !== folder && isInsideOrEqual(full, folder))) {
      return this.#outsideThrowaway(asked);
    }
    const checked = place.checked === "itself" ? full : dirname(full);
    const check = await checkPath(this.#options.inspector, { layout, path: checked, permitted, purpose: "write" });
    switch (check.status) {
      case "allowed":
        return granted(full);
      case "outside":
        return this.#outsideThrowaway(asked);
      case "through-link":
        return refused({
          resource: "files",
          asked,
          declared: `a link on that path leads to ${check.realPath}, outside the throwaway folders`,
          change: "Remove the link: the broker makes and removes nothing through a link.",
        });
      case "linked-component":
        return refused({
          resource: "files",
          asked,
          declared: `${basename(check.link)} on that path is a link, and the broker makes and removes nothing through a link`,
          change: `Replace the link ${check.link} with a real folder.`,
        });
    }
  }

  async #checkedPath(path: string, purpose: Purpose): Promise<Answer<string>> {
    const permitted = purpose === "read" ? this.#grants.readPaths : this.#grants.writePaths;
    const check = await checkPath(this.#options.inspector, { layout: this.#options.layout, path, permitted, purpose });
    return check.status === "allowed" ? granted(check.path) : this.#pathRefusal(check, purpose);
  }

  #pathRefusal(check: Exclude<PathCheck, { readonly status: "allowed" }>, purpose: Purpose): Answer<string> {
    const layout = this.#options.layout;
    const permitted = purpose === "read" ? this.#grants.readPaths : this.#grants.writePaths;
    const shown = permitted.map((path) => shownPath(layout, path));
    const asked = `${this.#asking} to ${purpose} ${check.path}`;
    const manifestLine = `resources.files.${purpose} in ${manifestOf(this.#grants)}`;
    switch (check.status) {
      case "outside":
        return refused({
          resource: "files",
          asked,
          declared: `the mode ${this.#grants.mode} may ${purpose} only: ${listed(shown, "nothing")}`,
          change: `To allow it, add ${shownPath(layout, check.path)} under ${manifestLine}.`,
        });
      case "through-link":
        return refused({
          resource: "files",
          asked,
          declared: `a link on that path leads to ${check.realPath}, outside the permitted paths`,
          change: "Remove the link: a mode may not reach files through a link that leaves its folders.",
        });
      case "linked-component":
        return refused({
          resource: "files",
          asked,
          declared: `${basename(check.link)} on that path is a link, and the broker writes through no link`,
          change: `Replace the link ${check.link} with a real folder or file.`,
        });
    }
  }

  #urlRefusal(check: Exclude<UrlCheck, { readonly status: "allowed" }>, redirected: boolean): Answer<never> {
    const hosts = this.#grants.hosts;
    const target = check.status === "not-a-url" ? "something that is not a URL" : check.url.href;
    const asked = redirected ? `A request was redirected to ${target}` : `${this.#asking} for ${target}`;
    const declaredHosts = `the mode ${this.#grants.mode} declares the hosts: ${listed(hosts, "none")}`;
    return refused({ resource: "http", asked, ...this.#urlRule(check, declaredHosts) });
  }

  #urlRule(
    check: Exclude<UrlCheck, { readonly status: "allowed" }>,
    declaredHosts: string,
  ): { readonly declared: string; readonly change: string } {
    switch (check.status) {
      case "not-a-url":
        return { declared: "the broker sends requests to https URLs only", change: "Send a full https:// URL." };
      case "not-https":
        return {
          declared: "the broker sends requests over https only",
          change: "Use an https:// URL; no manifest line allows another scheme.",
        };
      case "credentials-in-url":
        return { declared: "the broker sends no credentials in a URL", change: "Send credentials in a header." };
      case "other-port":
        return {
          declared: "the broker reaches declared hosts on the default https port only",
          change: "Use the host without a port.",
        };
      case "undeclared-host":
        return {
          declared: declaredHosts,
          change: `To allow it, add ${check.url.hostname} under resources.network in ${manifestOf(this.#grants)}.`,
        };
    }
  }

  async #sendOnce(request: HttpRequest): Promise<Answer<HttpResponse>> {
    let response: HttpResponse;
    try {
      response = await this.#options.http.request(request);
    } catch (error) {
      return failed(`The request to ${request.url} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.#append("http", {
      step: this.#options.place.stepKey,
      method: request.method,
      url: request.url,
      headers: loggedHeaders(request.headers),
      status: response.status,
    });
    return granted(response);
  }

  #cappedResponse(response: HttpResponse): Answer<HttpResponse> {
    const size = Buffer.byteLength(response.body);
    if (size > this.#limits.httpResponseBytes) {
      return failed(
        `The response is ${String(size)} bytes, more than ${String(this.#limits.httpResponseBytes)} bytes.`,
      );
    }
    return granted(response);
  }
}
