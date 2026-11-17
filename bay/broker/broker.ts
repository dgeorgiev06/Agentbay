import { createHash } from "node:crypto";
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
import type { ActionCaller, Effect, EventSink, Json, ModeGrants, Permissions, StepPlace } from "../contracts.ts";
import { DatabaseProcess } from "./database-process.ts";
import {
  type ActionAt,
  askedSentence,
  type CommandOperation,
  describedOperation,
  commandRefusal,
  effectRefusal,
  type BrokerOperation,
  type SpendAmounts,
} from "./effect-rule.ts";
import { checkPath } from "./file-access.ts";
import { databaseEntries, type DatabaseOperationName } from "./database-operations.ts";
import { dataFolder, fileEntries, type FileOperationName } from "./file-operations.ts";
import { otherEntries, type OtherOperationName } from "./other-operations.ts";
import { checkUrl, type Hop, loggedHeaders, nextRequest, redirectTarget, type UrlCheck } from "./http-access.ts";
import { isInsideOrEqual, pathIn, shownPath, type Layout } from "../layout.ts";
import type { SecretStore } from "../secrets.ts";
import type { AgentQueryLimits, Entries, Step } from "./rule.ts";
import type { CommandOutput, CommandRan, CommandRequest } from "../sdk.ts";

export type BrokerLimits = AgentQueryLimits & {
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
  readonly call?: ActionCaller;
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

function noCaller(stepKey: string): ActionCaller {
  return () =>
    Promise.resolve({
      status: "failed",
      reason: `The step ${stepKey} cannot call an action: only a script's step calls actions.`,
      spent: { items: 0, usd: 0, tokens: 0, minutes: 0 },
    });
}

type EntryName = FileOperationName | DatabaseOperationName | OtherOperationName;

export class Broker {
  readonly #options: BrokerOptions;
  readonly #grants: ModeGrants;
  readonly #effects: readonly Effect[];
  readonly #limits: BrokerLimits;
  readonly #databases = new Map<string, DatabaseProcess>();
  #unnamedMigration: Promise<Answer<readonly string[]>> | undefined;
  readonly #spent = { items: 0, usd: 0, tokens: 0 };
  readonly entries: Entries<EntryName>;

  constructor(options: BrokerOptions) {
    this.#options = options;
    this.#grants = options.permissions.grants;
    this.#effects = options.permissions.actionEffects;
    this.#limits = { ...defaultBrokerLimits, ...options.limits };
    const step = this.#step();
    this.entries = { ...fileEntries(step), ...databaseEntries(step), ...otherEntries(step) };
  }

  #step(): Step {
    const options = this.#options;
    const { layout, inspector } = options;
    return {
      asking: { grants: this.#grants, effects: this.#effects, at: this.#at, layout, inspector },
      doing: {
        stepKey: options.place.stepKey,
        files: options.files,
        throwawayFolders: options.throwawayFolders,
        inspector,
        scrubber: options.secrets,
        secrets: options.secrets,
        clock: options.clock,
        childProcesses: options.childProcesses,
        limits: this.#limits,
        record: (kind, detail) => this.#append(kind, detail),
        call: options.call ?? noCaller(options.place.stepKey),
        addSpending: (amounts) => {
          this.#spent.items += amounts.items;
          this.#spent.usd += amounts.usd;
          this.#spent.tokens += amounts.tokens;
        },
        databaseOf: (file) => this.#databaseOf(file),
        migratedOnce: (migrate) => {
          this.#unnamedMigration ??= migrate();
          return this.#unnamedMigration;
        },
      },
      settled: (answer, detail) => this.#settle(answer, detail),
    };
  }

  request(request: HttpRequest): Promise<Answer<HttpResponse>> {
    const operation = { kind: "http.request" as const, method: request.method, url: request.url };
    return this.#guarded(operation, () => this.#sendFollowingRedirects(request));
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

  spent(): SpendAmounts {
    return { ...this.#spent };
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
