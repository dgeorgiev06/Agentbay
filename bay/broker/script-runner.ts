import { resolve } from "node:path/posix";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type Answer, manifestOf, refused } from "../answers.ts";
import { openStep, type OpenStep, type StepBrokerLimits, type StepServices } from "./step-broker.ts";
import type { Child, ChildEnd, ChildRequest } from "../ports.ts";
import type { RunEvent, ScriptRequest, ScriptRunner, Spend, StepOutcome } from "../contracts.ts";
import { mayRemoveFiles, writableFolders } from "./rule.ts";
import { escapingLinks } from "./folder-links.ts";
import { notAValidMessage, type OperationName, type Requests, type Results, shapes } from "./operations.ts";
import { isInsideOrEqual, shownPath } from "../layout.ts";
import {
  type AskedFor,
  type ChildMessage,
  childMessageOf,
  packageArgument,
  packageFolderOf,
  removalAllowedArgument,
} from "./script-protocol.ts";

type ScriptRunnerLimits = StepBrokerLimits & {
  readonly scriptOutputBytes: number;
};

export type ScriptRunnerOptions = StepServices & {
  readonly limits?: Partial<ScriptRunnerLimits>;
};

type Final = Extract<ChildMessage, { readonly type: "done" | "failed" | "crashed" }>;

type Misread = Extract<ChildMessage, { readonly type: "unreadable-request" | "unread-answer" }>;

type RunState = {
  final: Final | undefined;
  stopped: string | undefined;
  readonly inFlight: Promise<void>[];
};

type Started = {
  readonly broker: OpenStep;
  readonly request: ScriptRequest;
  readonly state: RunState;
};

type Running = Started & { readonly answering: Answering };

const defaultScriptOutputBytes = 4 * 1024 * 1024;

const bayFolder = fileURLToPath(new URL("..", import.meta.url));

const hostFile = `${bayFolder}broker/script-host.ts`;

const preloadFile = `${bayFolder}broker/script-preload.ts`;

const filesTheHostReads: readonly string[] = [
  hostFile,
  preloadFile,
  `${bayFolder}broker/operations.ts`,
  `${bayFolder}broker/script-protocol.ts`,
  `${bayFolder}protocol-json.ts`,
  `${bayFolder}sdk.ts`,
  `${bayFolder}yaml-text.ts`,
  `${bayFolder}value-check.ts`,
  `${bayFolder}json.ts`,
];

type KernelPackage = {
  readonly specifier: string;
  readonly url: string;
  readonly folder: string;
};

function kernelPackage(specifier: string): KernelPackage {
  const url = import.meta.resolve(specifier);
  return { specifier, url, folder: packageFolderOf(specifier, fileURLToPath(url)) };
}

const packagesTheHostReads: readonly KernelPackage[] = [
  "yaml",
  "ajv/dist/2020.js",
  "fast-deep-equal",
  "fast-uri",
  "json-schema-traverse",
].map(kernelPackage);

function grants(access: "read" | "write", path: string): readonly string[] {
  if (filesTheHostReads.includes(path)) {
    return [`--allow-fs-${access}=${path}`];
  }
  return [`--allow-fs-${access}=${path}`, `--allow-fs-${access}=${path}/*`];
}

export function scriptCommand(scriptFile: string, request: ScriptRequest): readonly string[] {
  const granted = request.permissions.grants;
  const readable = [
    ...new Set([
      ...filesTheHostReads,
      ...packagesTheHostReads.map((kernel) => kernel.folder),
      granted.modeFolder,
      ...granted.readPaths,
    ]),
  ];
  return [
    "--permission",
    ...readable.flatMap((path) => grants("read", path)),
    ...writableFolders(request.permissions).flatMap((path) => grants("write", path)),
    "--disable-warning=ExperimentalWarning",
    `--import=${pathToFileURL(preloadFile).href}`,
    hostFile,
    scriptFile,
    ...packagesTheHostReads.map((kernel) => packageArgument(kernel.specifier, kernel.url)),
    ...(mayRemoveFiles(request.permissions) ? [removalAllowedArgument] : []),
  ];
}

function startMessage(request: ScriptRequest, now: Date): Readonly<Record<string, unknown>> {
  const caller = request.caller === undefined ? {} : { caller: request.caller };
  const skillInput = request.skillInput === undefined ? {} : { skillInput: request.skillInput };
  const fields = { input: request.input, settings: request.settings, now: now.toISOString() };
  return { type: "start", ...fields, ...caller, ...skillInput };
}

function seconds(milliseconds: number): string {
  return String(Number((milliseconds / 1000).toFixed(3)));
}

type Answering = {
  readonly [Name in OperationName]: (request: Requests[Name]) => Promise<Answer<Results[Name]>>;
};

function answeringFor(started: Started): Answering {
  return started.broker.entries;
}

function answerFor<Name extends OperationName>(
  running: Running,
  asked: AskedFor<Name>,
): Promise<Answer<Results[Name]>> {
  return running.answering[asked.operation](asked.request);
}

type EndLimits = {
  readonly request: ScriptRequest;
  readonly outputBytes: number;
};

function whereTheLimitWasSet(request: ScriptRequest): string {
  const field = `actions.${request.place.action}.scriptTimeLimitSeconds`;
  const manifest = manifestOf(request.permissions.grants);
  switch (request.timeLimitSetBy) {
    case "action":
      return `set by ${field} in ${manifest}.`;
    case "kernel":
      return `the kernel's limit for a script step. Its action may declare a longer one in ${field} in ${manifest}.`;
    case "budget":
      return "the minutes left of the run's budget.";
  }
}

function stoppedReason(request: ScriptRequest): string {
  const shown = seconds(request.timeLimitMilliseconds);
  return `The script was stopped at its time limit of ${shown} seconds, ${whereTheLimitWasSet(request)}`;
}

function endReason(end: ChildEnd, limits: EndLimits): string {
  switch (end.how) {
    case "timed-out":
      return stoppedReason(limits.request);
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

function outcomeOf(state: RunState, end: ChildEnd, limits: EndLimits) {
  if (state.stopped !== undefined) {
    return { status: "failed" as const, reason: state.stopped };
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
  const limits = { outputBytes: options.limits?.scriptOutputBytes ?? defaultScriptOutputBytes };
  const zero = { items: 0, usd: 0, tokens: 0, minutes: 0 };
  const failure = (reason: string): StepOutcome => ({
    status: "failed",
    reason: options.secrets.redact(reason),
    spent: zero,
  });

  async function refusedBeforeStart(request: ScriptRequest, broker: OpenStep): Promise<string | undefined> {
    const permissions = request.permissions.grants;
    const scriptFile = resolve(permissions.modeFolder, request.script);
    if (!isInsideOrEqual(scriptFile, permissions.modeFolder)) {
      return `The script ${request.script} lies outside the folder of the mode ${permissions.mode}.`;
    }
    const folders = [permissions.modeFolder, ...permissions.readPaths, ...permissions.writePaths];
    const links = await escapingLinks(options.inspector, options.layout, folders);
    if (links.length === 0) {
      return undefined;
    }
    const described = links.map(
      (found) => `${shownPath(options.layout, found.link)} points to ${found.target ?? "nothing"}`,
    );
    const answer = await broker.settled(
      refused({
        resource: "script",
        asked: `The script ${request.script} was to run with links that leave their folders (${described.join("; ")})`,
        declared: "a granted folder may hold only links that stay inside it",
        change: `Remove the links, or change resources.files in ${manifestOf(permissions)}.`,
      }),
    );
    return answer.ok ? undefined : answer.message;
  }

  function misreadingEvent(started: Started, misread: Misread): RunEvent {
    const detail = {
      resource: shapes[misread.operation].resource,
      step: started.request.place.stepKey,
      operation: misread.operation,
      message: misread.sentence,
    };
    return {
      at: options.clock.now().toISOString(),
      runId: started.request.place.runId,
      kind: "refused",
      detail: options.secrets.redactJson(detail),
    };
  }

  function heard(running: Running, child: Child, line: string): void {
    const { state } = running;
    const message = childMessageOf(line);
    const stop = (reason: string): void => {
      state.stopped ??= reason;
      child.kill();
    };
    if (message === undefined || (message.type !== "request" && state.final !== undefined)) {
      stop(notAValidMessage);
      return;
    }
    switch (message.type) {
      case "request":
        state.inFlight.push(
          answerFor(running, message.asked).then((answer) => {
            child.send(JSON.stringify({ type: "answer", id: message.id, answer }));
          }),
        );
        return;
      case "unreadable-request":
        state.inFlight.push(options.events.append(misreadingEvent(running, message)));
        stop(message.sentence);
        return;
      case "unread-answer":
        state.inFlight.push(options.events.append(misreadingEvent(running, message)));
        return;
      case "done":
      case "failed":
      case "crashed":
        state.final = message;
    }
  }

  async function runChild(started: Started, milliseconds: number): Promise<StepOutcome> {
    const { request, state, broker } = started;
    const running = { ...started, answering: answeringFor(started) };
    const startTime = options.clock.now();
    const startedAt = startTime.getTime();
    const childRequest: ChildRequest = {
      command: process.execPath,
      arguments: scriptCommand(resolve(request.permissions.grants.modeFolder, request.script), request),
      directory: request.permissions.grants.modeFolder,
      environment: {},
      timeoutMilliseconds: milliseconds,
      maximumOutputBytes: limits.outputBytes,
    };
    const child = options.childProcesses.start(childRequest, (line) => {
      heard(running, child, line);
    });
    child.send(JSON.stringify(startMessage(request, startTime)));
    const end = await child.ended;
    broker.close();
    await Promise.all(state.inFlight);
    const minutes = (options.clock.now().getTime() - startedAt) / 60_000;
    const outcome = outcomeOf(state, end, { request, outputBytes: limits.outputBytes });
    const spent: Spend = { ...broker.spent(), minutes };
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
    const startedAt = options.clock.now();
    const broker = openStep({
      layout: options.layout,
      permissions: request.permissions,
      place: request.place,
      files: options.files,
      throwawayFolders: options.throwawayFolders,
      inspector: options.inspector,
      http: options.http,
      secrets: options.secrets,
      events: options.events,
      clock: options.clock,
      childProcesses: options.childProcesses,
      processes: options.processes,
      commandSearchPath: options.commandSearchPath,
      interfaceSchemas: options.interfaceSchemas,
      call: request.call,
      stepTime: { startedAt, milliseconds },
      limits: { databaseMilliseconds: milliseconds, ...options.limits },
    });
    try {
      const refusal = await refusedBeforeStart(request, broker);
      if (refusal !== undefined) {
        return failure(refusal);
      }
      const state: RunState = {
        final: undefined,
        stopped: undefined,
        inFlight: [],
      };
      return await runChild({ broker, request, state }, milliseconds);
    } finally {
      broker.close();
    }
  }

  return { run };
}
