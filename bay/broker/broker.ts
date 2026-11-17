import { type Answer, failed, manifestOf } from "../answers.ts";
import type { ChildProcesses, Clock, FileInspector, FileSystem, Http, Processes, ThrowawayFolders } from "../ports.ts";
import type { ActionCaller, Effect, EventSink, Json, ModeGrants, Permissions, StepPlace } from "../contracts.ts";
import { DatabaseProcess } from "./database-process.ts";
import type { ActionAt, SpendAmounts } from "./effect-rule.ts";
import { databaseEntries, type DatabaseOperationName } from "./database-operations.ts";
import { fileEntries, type FileOperationName } from "./file-operations.ts";
import { httpEntries, type HttpOperationName } from "./http-operations.ts";
import { otherEntries, type OtherOperationName } from "./other-operations.ts";
import { commandEntries, type CommandOperationName } from "./command-operations.ts";
import type { Layout } from "../layout.ts";
import type { SecretStore } from "../secrets.ts";
import type { Entries, Step, StepLimits } from "./rule.ts";

export type BrokerLimits = StepLimits & {
  readonly databaseMilliseconds: number;
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

type EntryName =
  FileOperationName | DatabaseOperationName | OtherOperationName | HttpOperationName | CommandOperationName;

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
    this.entries = {
      ...fileEntries(step),
      ...databaseEntries(step),
      ...otherEntries(step),
      ...httpEntries(step),
      ...commandEntries(step),
    };
  }

  #step(): Step {
    const options = this.#options;
    const { layout, inspector } = options;
    return {
      asking: { grants: this.#grants, effects: this.#effects, at: this.#at, layout, inspector, limits: this.#limits },
      doing: {
        stepKey: options.place.stepKey,
        files: options.files,
        throwawayFolders: options.throwawayFolders,
        inspector,
        scrubber: options.secrets,
        secrets: options.secrets,
        clock: options.clock,
        http: options.http,
        processes: options.processes,
        commandSearchPath: options.commandSearchPath,
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

  spent(): SpendAmounts {
    return { ...this.#spent };
  }

  report<T>(answer: Answer<T>): Promise<Answer<T>> {
    return this.#settle(answer);
  }

  get #at(): ActionAt {
    const place = this.#options.place;
    return { stepKey: place.stepKey, action: place.action, manifest: manifestOf(this.#grants) };
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
}
