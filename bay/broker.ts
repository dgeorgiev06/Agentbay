import { basename, resolve } from "node:path/posix";
import { type AgentQueryResult, runAgentQuery } from "./agent-query.ts";
import { type Answer, failed, granted, listed, manifestOf, refused } from "./answers.ts";
import type { ChildProcesses, Clock, FileInspector, FileSystem, Http, HttpRequest, HttpResponse } from "./ports.ts";
import type { EventSink, Json, Permissions, StepPlace } from "./contracts.ts";
import type { DatabaseResult, ExecuteResult, Migration, Row, SqlParameters } from "./database.ts";
import { DatabaseProcess } from "./database-process.ts";
import { checkPath, type PathCheck, type Purpose } from "./file-access.ts";
import { checkUrl, type Hop, loggedHeaders, nextRequest, redirectTarget, type UrlCheck } from "./http-access.ts";
import { isInsideOrEqual, shownPath, type Layout } from "./layout.ts";
import type { SecretStore } from "./secrets.ts";
import { isJsonRecord } from "./protocol-json.ts";
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
};

export type BrokerOptions = {
  readonly layout: Layout;
  readonly permissions: Permissions;
  readonly place: StepPlace;
  readonly files: FileSystem;
  readonly inspector: FileInspector;
  readonly http: Http;
  readonly secrets: SecretStore;
  readonly events: EventSink;
  readonly clock: Clock;
  readonly childProcesses: ChildProcesses;
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
};

const migrationName = /^\d{4}-[^/]+\.sql$/;

const brokerKinds: readonly string[] = ["refused", "http", "redacted"];

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

export class Broker {
  readonly #options: BrokerOptions;
  readonly #permissions: Permissions;
  readonly #limits: BrokerLimits;
  readonly #database: DatabaseProcess;

  constructor(options: BrokerOptions) {
    this.#options = options;
    this.#permissions = options.permissions;
    this.#limits = { ...defaultBrokerLimits, ...options.limits };
    this.#database = new DatabaseProcess({
      childProcesses: options.childProcesses,
      databaseFile: options.permissions.databaseFile,
      lifetimeMilliseconds: this.#limits.databaseMilliseconds,
    });
  }

  async migrate(): Promise<Answer<readonly string[]>> {
    const migrations = resolve(this.#permissions.modeFolder, this.#permissions.migrationsFolder);
    if (!isInsideOrEqual(migrations, this.#permissions.modeFolder)) {
      return this.#settle(
        refused({
          resource: "db",
          asked: `${this.#asking} to run the migrations in ${migrations}`,
          declared: `migrations must lie inside the mode's folder ${this.#permissions.modeFolder}`,
          change: `Point resources.db.migrations in ${manifestOf(this.#permissions)} at a folder of the mode.`,
        }),
      );
    }
    const names = (await this.#options.files.list(migrations)).filter((name) => name.endsWith(".sql"));
    const misnamed = names.filter((name) => !migrationName.test(name));
    if (misnamed.length > 0) {
      return this.#settle(failed(`Migration files are named NNNN-name.sql; rename ${misnamed.join(", ")}.`));
    }
    const ordered: Migration[] = [];
    for (const name of names.sort()) {
      ordered.push({ name, sql: (await this.#options.files.readText(`${migrations}/${name}`)) ?? "" });
    }
    const appliedAt = this.#options.clock.now().toISOString();
    const result = await this.#database.request({ method: "migrate", migrations: ordered, appliedAt });
    return this.#settle(this.#databaseAnswer(result, { keyword: "migrate", fits: isNames }));
  }

  async execute(sql: string, parameters: SqlParameters = []): Promise<Answer<ExecuteResult>> {
    const keyword = leadingKeyword(sql);
    if (![...readKeywords, ...writeKeywords].includes(keyword)) {
      return this.#settle(this.#statementRefusal(keyword, [...readKeywords, ...writeKeywords]));
    }
    const writable = this.#permissions.effects.includes("write");
    const result = await this.#database.request({ method: "execute", sql, parameters, writable });
    return this.#settle(this.#databaseAnswer(result, { keyword, fits: isExecuteResult }));
  }

  async query(sql: string, parameters: SqlParameters = []): Promise<Answer<readonly Row[]>> {
    const keyword = leadingKeyword(sql);
    if (!readKeywords.includes(keyword)) {
      return this.#settle(this.#statementRefusal(keyword, readKeywords));
    }
    const result = await this.#database.request({ method: "query", sql, parameters });
    return this.#settle(this.#databaseAnswer(result, { keyword, fits: isRows }));
  }

  async agentQuery(sql: string): Promise<Answer<AgentQueryResult>> {
    const databaseFile = this.#permissions.databaseFile;
    if (!(await this.#options.files.exists(databaseFile))) {
      return this.#settle(failed(`The mode ${this.#permissions.mode} has no database yet; run its migrations first.`));
    }
    const limits = this.#limits;
    const outcome = await runAgentQuery(this.#options.childProcesses, {
      databaseFile,
      sql,
      limits: {
        rows: limits.agentQueryRows,
        resultBytes: limits.agentQueryResultBytes,
        milliseconds: limits.agentQueryMilliseconds,
      },
    });
    const rows = String(limits.agentQueryRows);
    const milliseconds = String(limits.agentQueryMilliseconds);
    const rules =
      "agent queries run one read-only select over the mode's own database, where every table is readable, " +
      `return at most ${rows} rows and stop at the time limit of ${milliseconds} ms`;
    const change = "Send one select statement, narrowed with where, limit or an aggregate.";
    switch (outcome.status) {
      case "done":
        return this.#settle(granted(this.#redactedResult(outcome.value)));
      case "refused":
        return this.#settle(
          refused({
            resource: "db",
            asked: `An agent's query was refused (${outcome.reason})`,
            declared: rules,
            change,
          }),
        );
      case "timed-out":
        return this.#settle(
          refused({
            resource: "db",
            asked: "An agent's query was still running and was killed",
            declared: rules,
            change,
          }),
        );
      case "failed":
        return this.#settle(failed(outcome.message));
    }
  }

  async readFile(path: string): Promise<Answer<string>> {
    const checked = await this.#checkedPath(path, "read");
    if (!checked.ok) {
      return this.#settle(checked);
    }
    const text = await this.#options.files.readText(checked.value);
    return this.#settle(text === undefined ? failed(`The file ${checked.value} does not exist.`) : granted(text));
  }

  async writeFile(path: string, text: string): Promise<Answer<null>> {
    const checked = await this.#checkedPath(path, "write");
    if (!checked.ok) {
      return this.#settle(checked);
    }
    const redacted = this.#options.secrets.redactHandedOut(text);
    if (redacted !== text) {
      await this.#append("redacted", {
        step: this.#options.place.stepKey,
        file: checked.value,
        message: "A secret value handed out to this step was removed from the text before the file was written.",
      });
    }
    await this.#options.files.writeAtomic(checked.value, redacted);
    return this.#settle(granted(null));
  }

  async listFiles(path: string): Promise<Answer<readonly string[]>> {
    const checked = await this.#checkedPath(path, "read");
    if (!checked.ok) {
      return this.#settle(checked);
    }
    return this.#settle(granted(await this.#options.files.list(checked.value)));
  }

  async secret(name: string): Promise<Answer<string>> {
    return this.#settle(await this.#options.secrets.get(name, this.#permissions));
  }

  async request(request: HttpRequest): Promise<Answer<HttpResponse>> {
    const size = Buffer.byteLength(request.body ?? "");
    if (size > this.#limits.httpRequestBytes) {
      return this.#settle(
        refused({
          resource: "http",
          asked: `${this.#asking} to send a request body of ${String(size)} bytes`,
          declared: `the broker sends at most ${String(this.#limits.httpRequestBytes)} bytes`,
          change: "Send a smaller body; no manifest line raises this cap.",
        }),
      );
    }
    let current = request;
    for (let hops = 0; hops <= this.#limits.httpRedirects; hops += 1) {
      const check = checkUrl(current.url, this.#permissions.hosts);
      if (check.status !== "allowed") {
        return this.#settle(this.#urlRefusal(check, hops > 0));
      }
      const response = await this.#sendOnce(current);
      if (!response.ok) {
        return this.#settle(response);
      }
      const hop: Hop = { request: current, response: response.value };
      const target = redirectTarget(hop);
      if (target === undefined) {
        return this.#settle(this.#cappedResponse(response.value));
      }
      current = nextRequest(hop, target);
    }
    return this.#settle(failed(`The request was redirected more than ${String(this.#limits.httpRedirects)} times.`));
  }

  async emit(kind: string, detail: Json): Promise<Answer<null>> {
    if (brokerKinds.includes(kind)) {
      return this.#settle(
        refused({
          resource: "events",
          asked: `${this.#asking} to emit an event of the kind ${kind}`,
          declared: `the kinds ${brokerKinds.join(" and ")} are written only by the broker`,
          change: "Choose another kind for the event.",
        }),
      );
    }
    await this.#append(kind, detail);
    return granted(null);
  }

  report<T>(answer: Answer<T>): Promise<Answer<T>> {
    return this.#settle(answer);
  }

  get #asking(): string {
    return `The step ${this.#options.place.stepKey} asked`;
  }

  close(): void {
    this.#database.close();
  }

  async #append(kind: string, detail: Json): Promise<void> {
    await this.#options.events.append({
      at: this.#options.clock.now().toISOString(),
      runId: this.#options.place.runId,
      kind,
      detail: this.#options.secrets.redactJson(detail),
    });
  }

  async #settle<T>(answer: Answer<T>): Promise<Answer<T>> {
    if (answer.ok) {
      return answer;
    }
    const secrets = this.#options.secrets;
    const message = secrets.redact(answer.message);
    if (answer.kind === "failed") {
      return failed(message);
    }
    await this.#append("refused", { resource: answer.resource, step: this.#options.place.stepKey, message });
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
        return failed(`The mode ${this.#permissions.mode} has no database yet; run its migrations first.`);
      case "writes-on-read-only":
        return refused({
          resource: "db",
          asked: `${this.#asking} in action ${place.action} to run a write statement (it starts with "${keyword}")`,
          declared: `the action ${place.action} declares the effects: ${listed(this.#permissions.effects, "none")}`,
          change: `To allow it, add write to actions.${place.action}.effects in ${manifestOf(this.#permissions)}.`,
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

  async #checkedPath(path: string, purpose: Purpose): Promise<Answer<string>> {
    const permitted = purpose === "read" ? this.#permissions.readPaths : this.#permissions.writePaths;
    const check = await checkPath(this.#options.inspector, { layout: this.#options.layout, path, permitted, purpose });
    return check.status === "allowed" ? granted(check.path) : this.#pathRefusal(check, purpose);
  }

  #pathRefusal(check: Exclude<PathCheck, { readonly status: "allowed" }>, purpose: Purpose): Answer<string> {
    const layout = this.#options.layout;
    const permitted = purpose === "read" ? this.#permissions.readPaths : this.#permissions.writePaths;
    const shown = permitted.map((path) => shownPath(layout, path));
    const asked = `${this.#asking} to ${purpose} ${check.path}`;
    const manifestLine = `resources.files.${purpose} in ${manifestOf(this.#permissions)}`;
    switch (check.status) {
      case "outside":
        return refused({
          resource: "files",
          asked,
          declared: `the mode ${this.#permissions.mode} may ${purpose} only: ${listed(shown, "nothing")}`,
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
    const hosts = this.#permissions.hosts;
    const target = check.status === "not-a-url" ? "something that is not a URL" : check.url.href;
    const asked = redirected ? `A request was redirected to ${target}` : `${this.#asking} for ${target}`;
    const declaredHosts = `the mode ${this.#permissions.mode} declares the hosts: ${listed(hosts, "none")}`;
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
          change: `To allow it, add ${check.url.hostname} under resources.network in ${manifestOf(this.#permissions)}.`,
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
