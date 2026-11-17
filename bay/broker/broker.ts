import type { Answer, RefusalWording } from "../answers.ts";
import type { Effect, Permissions, ScriptRunner, StepPlace } from "../contracts.ts";
import type { OperationName, Results } from "./operations.ts";
import { type ActionAt, type EntryRequests, missingEffectRefusal, type Need, writableFolders } from "./rule.ts";
import { createScriptRunner, type ScriptRunnerOptions } from "./script-runner.ts";
import { openStep } from "./step-broker.ts";

type Broker = {
  readonly scripts: ScriptRunner;
  readonly forStep: (place: StepPlace, permissions: Permissions) => StepBroker;
};

export type StepBroker = {
  readonly ask: <Name extends OperationName>(
    name: Name,
    request: EntryRequests[Name],
  ) => Promise<Answer<Results[Name]>>;
  readonly close: () => void;
};

type Reach = {
  readonly writableFolders: readonly string[];
  readonly commands: readonly string[];
};

const everyEffect: readonly Effect[] = ["read", "write", "network", "spend", "delete"];

const reportsDollars: Need = { effect: "spend", because: "Reporting dollars an agent spent needs the spend effect" };

export function createBroker(services: ScriptRunnerOptions): Broker {
  return {
    scripts: createScriptRunner(services),
    forStep: (place, permissions) => {
      const step = openStep({ ...services, place, permissions });
      return { ask: (name, request) => step.entries[name](request), close: step.close };
    },
  };
}

export function reachOf(permissions: Permissions): Reach {
  const runsAnyCommand = everyEffect.every((effect) => permissions.actionEffects.includes(effect));
  return {
    writableFolders: writableFolders(permissions),
    commands: runsAnyCommand ? permissions.grants.commands.map((command) => command.words.join(" ")) : [],
  };
}

export function submissionRefusal(
  spentUsd: number,
  effects: readonly Effect[],
  at: ActionAt,
): RefusalWording | undefined {
  const needing = {
    resource: "spend" as const,
    doing: `report spending ${String(spentUsd)} US dollars`,
    needs: spentUsd > 0 ? [reportsDollars] : [],
  };
  return missingEffectRefusal(needing, effects, at);
}
