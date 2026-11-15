import { relative, resolve } from "node:path/posix";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type Answer, failed, granted, manifestOf, refused } from "./answers.ts";
import { Broker, type BrokerLimits } from "./broker.ts";
import type { ChildEnd, ChildProcesses, ChildRequest, Clock, FileInspector, FileSystem, Http } from "./ports.ts";
import type { EventSink, Json, ScriptRequest, ScriptRunner, Spend, StepOutcome } from "./contracts.ts";
import { isInsideOrEqual } from "./file-access.ts";
import { escapingLinks } from "./folder-links.ts";
import { isJsonRecord } from "./protocol-json.ts";
import { type ChildMessage, childMessageOf, type ResourceRequest } from "./script-protocol.ts";
import type { SecretStore } from "./secrets.ts";

export type ScriptRunnerLimits = {
  readonly outputBytes: number;
};

export type ScriptRunnerOptions = {
  readonly root: string;
  readonly files: FileSystem;
  readonly inspector: FileInspector;
  readonly http: Http;
  readonly secrets: SecretStore;
  readonly events: EventSink;
  readonly clock: Clock;
  readonly childProcesses: ChildProcesses;
  readonly limits?: Partial<ScriptRunnerLimits>;
  readonly brokerLimits?: Partial<BrokerLimits>;
};

type Spent = { items: number; usd: number; tokens: number };

type Final = Exclude<ChildMessage, { readonly type: "request" }>;

type RunState = {
  final: Final | undefined;
  malformed: boolean;
  readonly spent: Spent;
  readonly inFlight: Promise<void>[];
};

type Started = {
  readonly broker: Broker;
  readonly request: ScriptRequest;
  readonly state: RunState;
};

const defaultScriptRunnerLimits: ScriptRunnerLimits = { outputBytes: 4 * 1024 * 1024 };

const bayFolder = fileURLToPath(new URL(".", import.meta.url));

const hostFile = `${bayFolder}script-host.ts`;

const preloadFile = `${bayFolder}script-preload.ts`;

const filesTheHostReads: readonly string[] = [
  hostFile,
  preloadFile,
  `${bayFolder}script-protocol.ts`,
  `${bayFolder}protocol-json.ts`,
  `${bayFolder}sdk.ts`,
];

const spendMeasures = ["items", "usd", "tokens"] as const;

function grants(access: "read" | "write", path: string): readonly string[] {
  if (filesTheHostReads.includes(path)) {
    return [`--allow-fs-${access}=${path}`];
  }
  return [`--allow-fs-${access}=${path}`, `--allow-fs-${access}=${path}/*`];
}

export function scriptCommand(scriptFile: string, request: ScriptRequest): readonly string[] {
  const permissions = request.permissions;
  const readable = [...new Set([...filesTheHostReads, permissions.modeFolder, ...permissions.readPaths])];
  return [
    "--permission",
    ...readable.flatMap((path) => grants("read", path)),
    ...permissions.writePaths.flatMap((path) => grants("write", path)),
    "--disable-warning=ExperimentalWarning",
    `--import=${pathToFileURL(preloadFile).href}`,
    hostFile,
    scriptFile,
  ];
}

function seconds(milliseconds: number): string {
  return String(Number((milliseconds / 1000).toFixed(3)));
}

function spendingAnswer(spending: Json, spent: Spent): Answer<null> {
  const wrong = refused({
    resource: "spend",
    asked: `The step reported the spending ${JSON.stringify(spending)}`,
    declared: "spending is given as items, usd and tokens, each a number of at least 0",
    change: "Report spending as { items, usd, tokens } with numbers of at least 0.",
  });
  if (!isJsonRecord(spending)) {
    return wrong;
  }
  const amounts: Partial<Spent> = {};
  for (const measure of spendMeasures) {
    const amount = spending[measure];
    if (amount !== undefined && (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0)) {
      return wrong;
    }
    amounts[measure] = amount ?? 0;
  }
  for (const measure of spendMeasures) {
    spent[measure] += amounts[measure] ?? 0;
  }
  return granted(null);
}

function brokerAnswer(broker: Broker, request: Exclude<ResourceRequest, { resource: "call" | "spend" }>) {
  switch (request.resource) {
    case "db.execute":
      return broker.execute(request.sql, request.parameters);
    case "db.query":
      return broker.query(request.sql, request.parameters);
    case "files.read":
      return broker.readFile(request.path);
    case "files.write":
      return broker.writeFile(request.path, request.text);
    case "files.list":
      return broker.listFiles(request.path);
    case "secrets.get":
      return broker.secret(request.name);
    case "http.request":
      return broker.request(request.request);
    case "events.emit":
      return broker.emit(request.kind, request.detail);
  }
}

async function answerFor(started: Started, request: ResourceRequest): Promise<Answer<Json>> {
  if (request.resource === "call") {
    const outcome = await started.request.call(request.reference, request.input);
    return outcome.status === "done" ? granted(outcome.output) : failed(outcome.reason);
  }
  if (request.resource === "spend") {
    return started.broker.report(spendingAnswer(request.spending, started.state.spent));
  }
  return brokerAnswer(started.broker, request);
}

function endReason(end: ChildEnd, limits: { readonly milliseconds: number; readonly outputBytes: number }): string {
  switch (end.how) {
    case "timed-out":
      return `The script was stopped at its time limit of ${seconds(limits.milliseconds)} seconds.`;
    case "output-exceeded":
      return `The script printed more than ${String(limits.outputBytes)} bytes and was stopped.`;
    case "not-started":
      return `The script process could not start: ${end.errorOutput}`;
    case "signalled":
      return `The script ended by the signal ${end.signal} without returning a result. ${end.errorOutput}`;
    case "exited":
      return `The script ended without returning a result (exit code ${String(end.exitCode)}). ${end.errorOutput}`;
  }
}

function outcomeOf(
  state: RunState,
  end: ChildEnd,
  limits: { readonly milliseconds: number; readonly outputBytes: number },
) {
  if (state.malformed) {
    return { status: "failed" as const, reason: "The script sent a line that is not a valid message." };
  }
  const final = state.final;
  if (end.how !== "exited" || final === undefined) {
    return { status: "failed" as const, reason: endReason(end, limits).trim() };
  }
  switch (final.type) {
    case "done":
      return end.exitCode === 0
        ? { status: "done" as const, output: final.output }
        : { status: "failed" as const, reason: endReason(end, limits).trim() };
    case "failed":
      return { status: "failed" as const, reason: final.reason };
    case "crashed":
      return { status: "failed" as const, reason: `The script failed: ${final.reason}` };
  }
}

export function createScriptRunner(options: ScriptRunnerOptions): ScriptRunner {
  const limits = { ...defaultScriptRunnerLimits, ...options.limits };
  const zero = { items: 0, usd: 0, tokens: 0, minutes: 0 };
  const failure = (reason: string): StepOutcome => ({
    status: "failed",
    reason: options.secrets.redact(reason),
    spent: zero,
  });

  async function refusedBeforeStart(request: ScriptRequest, broker: Broker): Promise<string | undefined> {
    const permissions = request.permissions;
    const scriptFile = resolve(permissions.modeFolder, request.script);
    if (!isInsideOrEqual(scriptFile, permissions.modeFolder)) {
      return `The script ${request.script} lies outside the folder of the mode ${permissions.mode}.`;
    }
    const folders = [permissions.modeFolder, ...permissions.readPaths, ...permissions.writePaths];
    const links = await escapingLinks(options.inspector, options.root, folders);
    if (links.length === 0) {
      return undefined;
    }
    const described = links.map(
      (found) => `${relative(options.root, found.link)} points to ${found.target ?? "nothing"}`,
    );
    const answer = await broker.report(
      refused({
        resource: "script",
        asked: `The script ${request.script} was to run with links that leave their folders (${described.join("; ")})`,
        declared: "a granted folder may hold only links that stay inside it",
        change: `Remove the links, or change resources.files in ${manifestOf(permissions)}.`,
      }),
    );
    return answer.ok ? undefined : answer.message;
  }

  async function runChild(started: Started, milliseconds: number): Promise<StepOutcome> {
    const { request, state, broker } = started;
    const startedAt = options.clock.now().getTime();
    const childRequest: ChildRequest = {
      command: process.execPath,
      arguments: scriptCommand(resolve(request.permissions.modeFolder, request.script), request),
      directory: request.permissions.modeFolder,
      environment: {},
      timeoutMilliseconds: milliseconds,
      maximumOutputBytes: limits.outputBytes,
    };
    const child = options.childProcesses.start(childRequest, (line) => {
      const message = childMessageOf(line);
      if (message === undefined || (message.type !== "request" && state.final !== undefined)) {
        state.malformed = true;
        child.kill();
      } else if (message.type === "request") {
        const answered = answerFor(started, message.request).then((answer) => {
          child.send(JSON.stringify({ type: "answer", id: message.id, answer }));
        });
        state.inFlight.push(answered);
      } else {
        state.final = message;
      }
    });
    child.send(JSON.stringify({ type: "start", input: request.input, settings: request.settings }));
    const end = await child.ended;
    broker.close();
    await Promise.all(state.inFlight);
    const minutes = (options.clock.now().getTime() - startedAt) / 60_000;
    const outcome = outcomeOf(state, end, { milliseconds, outputBytes: limits.outputBytes });
    const spent: Spend = { ...state.spent, minutes };
    if (outcome.status === "done") {
      return { status: "done", output: options.secrets.redactJson(outcome.output), spent };
    }
    return { status: "failed", reason: options.secrets.redact(outcome.reason), spent };
  }

  async function run(request: ScriptRequest): Promise<StepOutcome> {
    const milliseconds = request.timeLimitMilliseconds;
    if (milliseconds <= 0) {
      return failure("The step has no time left, so the script was not started.");
    }
    const broker = new Broker({
      root: options.root,
      permissions: request.permissions,
      place: request.place,
      files: options.files,
      inspector: options.inspector,
      http: options.http,
      secrets: options.secrets,
      events: options.events,
      clock: options.clock,
      childProcesses: options.childProcesses,
      limits: { databaseMilliseconds: milliseconds, ...options.brokerLimits },
    });
    try {
      const refusal = await refusedBeforeStart(request, broker);
      if (refusal !== undefined) {
        return failure(refusal);
      }
      const state: RunState = {
        final: undefined,
        malformed: false,
        spent: { items: 0, usd: 0, tokens: 0 },
        inFlight: [],
      };
      return await runChild({ broker, request, state }, milliseconds);
    } finally {
      broker.close();
    }
  }

  return { run };
}
