import { type Answer, errorLine, failed, type RefusalWording, refused } from "../answers.ts";
import type { Effect, Json, ModeGrants } from "../contracts.ts";
import type { Layout } from "../layout.ts";
import type { ChildProcesses, Clock, FileInspector, FileSystem, ThrowawayFolders } from "../ports.ts";
import type { SecretStore } from "../secrets.ts";
import type { DatabaseProcess } from "./database-process.ts";
import { type ActionAt, missingEffectRefusal, type Need, type SpendAmounts } from "./effect-rule.ts";
import { type OperationName, type Requests, type Results, shapes } from "./operations.ts";

export type EntryRequests = Omit<Requests, "db.migrate"> & {
  readonly "db.migrate": { readonly partition?: string };
};

export type Ruling<Allowed> =
  { readonly allowed: true; readonly value: Allowed } | { readonly allowed: false; readonly refusal: RefusalWording };

export type Distinct<Allowed, Request> = [Request] extends [Allowed] ? never : Allowed;

export type AgentQueryLimits = {
  readonly agentQueryRows: number;
  readonly agentQueryCellCharacters: number;
  readonly agentQueryResultBytes: number;
  readonly agentQueryMilliseconds: number;
};

export type Asking = {
  readonly grants: ModeGrants;
  readonly effects: readonly Effect[];
  readonly at: ActionAt;
  readonly layout: Layout;
  readonly inspector: FileInspector;
};

export type Doing = {
  readonly stepKey: string;
  readonly files: FileSystem;
  readonly throwawayFolders: ThrowawayFolders;
  readonly inspector: FileInspector;
  readonly scrubber: Pick<SecretStore, "redact" | "redactJson" | "redactKnownValues">;
  readonly secrets: Pick<SecretStore, "lookUp">;
  readonly clock: Clock;
  readonly childProcesses: ChildProcesses;
  readonly limits: AgentQueryLimits;
  readonly record: (kind: string, detail: Json) => Promise<void>;
  readonly addSpending: (amounts: SpendAmounts) => void;
  readonly databaseOf: (file: string) => DatabaseProcess;
  readonly migratedOnce: (migrate: () => Promise<Answer<readonly string[]>>) => Promise<Answer<readonly string[]>>;
};

export type RefusalDetail = { readonly [key: string]: Json };

export type Step = {
  readonly asking: Asking;
  readonly doing: Doing;
  readonly settled: <T>(answer: Answer<T>, detail: RefusalDetail) => Promise<Answer<T>>;
};

export type Definition<Name extends OperationName, Allowed> = {
  readonly operation: Name;
  readonly needs: (request: EntryRequests[Name]) => readonly Need[];
  readonly described: (request: EntryRequests[Name], asking: Asking) => string;
  readonly rule: (
    request: EntryRequests[Name],
    asking: Asking,
  ) => Promise<Ruling<Distinct<Allowed, EntryRequests[Name]>>>;
  readonly handler: (allowed: Allowed, doing: Doing) => Promise<Answer<Results[Name]>>;
  readonly refusalDetail: (request: EntryRequests[Name]) => RefusalDetail;
};

export type Entries<Names extends OperationName> = {
  readonly [Name in Names]: (request: EntryRequests[Name]) => Promise<Answer<Results[Name]>>;
};

export function allowedWith<Allowed>(value: Allowed): Ruling<Allowed> {
  return { allowed: true, value };
}

export function refusedWith(refusal: RefusalWording): Ruling<never> {
  return { allowed: false, refusal };
}

export function askingSentence(asking: Asking): string {
  return `The step ${asking.at.stepKey} asked`;
}

export function noRefusalDetail(): RefusalDetail {
  return {};
}

export async function answered<Name extends OperationName, Allowed>(
  definition: Definition<Name, Allowed>,
  request: EntryRequests[Name],
  step: Step,
): Promise<Answer<Results[Name]>> {
  const { asking } = step;
  const doing = definition.described(request, asking);
  const needing = { resource: shapes[definition.operation].resource, doing, needs: definition.needs(request) };
  const short = missingEffectRefusal(needing, asking.effects, asking.at);
  const detail = definition.refusalDetail(request);
  try {
    if (short !== undefined) {
      return await step.settled(refused(short), detail);
    }
    const ruling = await definition.rule(request, asking);
    const answer = ruling.allowed ? await definition.handler(ruling.value, step.doing) : refused(ruling.refusal);
    return await step.settled(answer, detail);
  } catch (error) {
    return step.settled(failed(`The step ${asking.at.stepKey} could not ${doing}: ${errorLine(error)}`), {});
  }
}
