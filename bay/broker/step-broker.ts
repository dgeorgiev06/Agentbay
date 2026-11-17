import { type Answer, failed, manifestOf } from "../answers.ts";
import type { ChildProcesses, Clock, FileInspector, FileSystem, Http, Processes, ThrowawayFolders } from "../ports.ts";
import type { ActionCaller, EventSink, Json, Permissions, StepPlace } from "../contracts.ts";
import { DatabaseProcess } from "./database-process.ts";
import { databaseEntries } from "./database-operations.ts";
import { fileEntries } from "./file-operations.ts";
import { httpEntries } from "./http-operations.ts";
import { otherEntries } from "./other-operations.ts";
import { commandEntries } from "./command-operations.ts";
import type { Layout } from "../layout.ts";
import type { SecretStore } from "../secrets.ts";
import type { OperationName } from "./operations.ts";
import type { Asking, Doing, Entries, RefusalDetail, SpendAmounts, Step, StepLimits } from "./rule.ts";

export type StepBrokerLimits = StepLimits & {
  readonly databaseMilliseconds: number;
};

export type StepServices = {
  readonly layout: Layout;
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
};

type StepOptions = StepServices & {
  readonly permissions: Permissions;
  readonly place: StepPlace;
  readonly limits?: Partial<StepBrokerLimits>;
  readonly call?: ActionCaller;
};

const defaultStepBrokerLimits: StepBrokerLimits = {
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

export type OpenStep = {
  readonly entries: Entries<OperationName>;
  readonly settled: <T>(answer: Answer<T>) => Promise<Answer<T>>;
  readonly spent: () => SpendAmounts;
  readonly close: () => void;
};

type Recorder = (kind: string, detail: Json) => Promise<void>;

type Databases = {
  readonly databaseOf: (file: string) => DatabaseProcess;
  readonly close: () => void;
};

function noCaller(stepKey: string): ActionCaller {
  return () =>
    Promise.resolve({
      status: "failed",
      reason: `The step ${stepKey} cannot call an action: only a script's step calls actions.`,
      spent: { items: 0, usd: 0, tokens: 0, minutes: 0 },
    });
}

function recorderOf(options: StepOptions): Recorder {
  return async (kind, detail) => {
    await options.events.append({
      at: options.clock.now().toISOString(),
      runId: options.place.runId,
      kind,
      detail: options.secrets.redactJson(detail),
    });
  };
}

function settlerOf(options: StepOptions, record: Recorder): Step["settled"] {
  const { secrets } = options;
  return async <T>(answer: Answer<T>, detail: RefusalDetail): Promise<Answer<T>> => {
    if (answer.ok) {
      return answer;
    }
    const message = secrets.redact(answer.message);
    if (answer.kind === "failed") {
      return failed(message);
    }
    await record("refused", { resource: answer.resource, step: options.place.stepKey, message, ...detail });
    return {
      ...answer,
      asked: secrets.redact(answer.asked),
      declared: secrets.redact(answer.declared),
      change: secrets.redact(answer.change),
      message,
    };
  };
}

function databasesOf(options: StepOptions, lifetimeMilliseconds: number): Databases {
  const open = new Map<string, DatabaseProcess>();
  return {
    databaseOf: (file) => {
      const known = open.get(file);
      if (known !== undefined) {
        return known;
      }
      const database = new DatabaseProcess({
        childProcesses: options.childProcesses,
        databaseFile: file,
        lifetimeMilliseconds,
      });
      open.set(file, database);
      return database;
    },
    close: () => {
      for (const database of open.values()) {
        database.close();
      }
      open.clear();
    },
  };
}

function askingOf(options: StepOptions, limits: StepLimits): Asking {
  const { grants, actionEffects } = options.permissions;
  const { place, layout, inspector } = options;
  const at = { stepKey: place.stepKey, action: place.action, manifest: manifestOf(grants) };
  return { grants, effects: actionEffects, at, layout, inspector, limits };
}

type StepState = {
  readonly limits: StepLimits;
  readonly record: Recorder;
  readonly databases: Databases;
  readonly spent: { items: number; usd: number; tokens: number };
};

function doingOf(options: StepOptions, state: StepState): Doing {
  const { spent } = state;
  let unnamedMigration: Promise<Answer<readonly string[]>> | undefined;
  return {
    stepKey: options.place.stepKey,
    files: options.files,
    throwawayFolders: options.throwawayFolders,
    inspector: options.inspector,
    scrubber: options.secrets,
    secrets: options.secrets,
    clock: options.clock,
    http: options.http,
    processes: options.processes,
    commandSearchPath: options.commandSearchPath,
    childProcesses: options.childProcesses,
    limits: state.limits,
    record: state.record,
    call: options.call ?? noCaller(options.place.stepKey),
    addSpending: (amounts) => {
      spent.items += amounts.items;
      spent.usd += amounts.usd;
      spent.tokens += amounts.tokens;
    },
    databaseOf: state.databases.databaseOf,
    migratedOnce: (migrate) => {
      unnamedMigration ??= migrate();
      return unnamedMigration;
    },
  };
}

export function openStep(options: StepOptions): OpenStep {
  const limits = { ...defaultStepBrokerLimits, ...options.limits };
  const record = recorderOf(options);
  const settled = settlerOf(options, record);
  const databases = databasesOf(options, limits.databaseMilliseconds);
  const spent = { items: 0, usd: 0, tokens: 0 };
  const doing = doingOf(options, { limits, record, databases, spent });
  const step: Step = { asking: askingOf(options, limits), doing, settled };
  return {
    entries: {
      ...fileEntries(step),
      ...databaseEntries(step),
      ...otherEntries(step),
      ...httpEntries(step),
      ...commandEntries(step),
    },
    settled: (answer) => settled(answer, {}),
    spent: () => ({ ...spent }),
    close: databases.close,
  };
}
