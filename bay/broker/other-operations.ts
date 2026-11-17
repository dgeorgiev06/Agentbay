import { granted, listed, manifestOf } from "../answers.ts";
import type { Json } from "../contracts.ts";
import { isJsonRecord } from "../protocol-json.ts";
import type { Need, SpendAmounts } from "./effect-rule.ts";
import { secretNamePattern } from "../policy.ts";
import type { OperationName } from "./operations.ts";
import {
  allowedWith,
  answered,
  askingSentence,
  type Definition,
  type Entries,
  noRefusalDetail,
  refusedWith,
  type Step,
} from "./rule.ts";

export type OtherOperationName = Extract<OperationName, "secrets.get" | "events.emit" | "spend">;

type DeclaredSecret = { readonly secret: string };

type ScriptEvent = { readonly eventKind: string; readonly detail: Json };

const brokerKinds: readonly string[] = ["refused", "http", "redacted", "command", "throwaway"];

const noAmounts: SpendAmounts = { items: 0, usd: 0, tokens: 0 };

const spendMeasures = ["items", "usd", "tokens"] as const;

const spends: Need = { effect: "spend", because: "Spending more than nothing needs the spend effect" };

function askedForSecret(name: string): string {
  return `The step asked for the secret ${name}`;
}

const secretsGet: Definition<"secrets.get", DeclaredSecret> = {
  operation: "secrets.get",
  needs: () => [],
  described: (request) => `get the secret ${request.name}`,
  rule: (request, asking) => {
    const { grants } = asking;
    if (!secretNamePattern.test(request.name)) {
      return Promise.resolve(
        refusedWith({
          resource: "secrets",
          asked: askedForSecret(request.name),
          declared: "secret names are made of upper-case letters, digits and underscores",
          change: `Rename the secret in resources.secrets in ${manifestOf(grants)} and where it is stored.`,
        }),
      );
    }
    if (!grants.secrets.includes(request.name)) {
      return Promise.resolve(
        refusedWith({
          resource: "secrets",
          asked: askedForSecret(request.name),
          declared: `the mode ${grants.mode} declares the secrets: ${listed(grants.secrets, "none")}`,
          change: `To allow it, add ${request.name} under resources.secrets in ${manifestOf(grants)}.`,
        }),
      );
    }
    return Promise.resolve(allowedWith({ secret: request.name }));
  },
  handler: (declared, doing) => doing.secrets.lookUp(declared.secret),
  refusalDetail: noRefusalDetail,
};

const eventsEmit: Definition<"events.emit", ScriptEvent> = {
  operation: "events.emit",
  needs: () => [],
  described: (request) => `emit an event of the kind ${request.kind}`,
  rule: (request, asking) => {
    if (brokerKinds.includes(request.kind)) {
      return Promise.resolve(
        refusedWith({
          resource: "events",
          asked: `${askingSentence(asking)} to emit an event of the kind ${request.kind}`,
          declared: `the kinds ${brokerKinds.join(" and ")} are written only by the broker`,
          change: "Choose another kind for the event.",
        }),
      );
    }
    return Promise.resolve(allowedWith({ eventKind: request.kind, detail: request.detail }));
  },
  handler: async (event, doing) => {
    await doing.record(event.eventKind, event.detail);
    return granted(null);
  },
  refusalDetail: noRefusalDetail,
};

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

function isSpending(amounts: SpendAmounts): boolean {
  return amounts.items > 0 || amounts.usd > 0 || amounts.tokens > 0;
}

const spend: Definition<"spend", SpendAmounts> = {
  operation: "spend",
  needs: (request) => (isSpending(spendAmountsOf(request.spending) ?? noAmounts) ? [spends] : []),
  described: (request) => `report spending ${JSON.stringify(spendAmountsOf(request.spending) ?? noAmounts)}`,
  rule: (request) => {
    const amounts = spendAmountsOf(request.spending);
    if (amounts === undefined) {
      return Promise.resolve(
        refusedWith({
          resource: "spend",
          asked: `The step reported the spending ${JSON.stringify(request.spending)}`,
          declared: "spending is given as items, usd and tokens, each a number of at least 0",
          change: "Report spending as { items, usd, tokens } with numbers of at least 0.",
        }),
      );
    }
    return Promise.resolve(allowedWith(amounts));
  },
  handler: (amounts, doing) => {
    doing.addSpending(amounts);
    return Promise.resolve(granted(null));
  },
  refusalDetail: noRefusalDetail,
};

export function otherEntries(step: Step): Entries<OtherOperationName> {
  return {
    "secrets.get": (request) => answered(secretsGet, request, step),
    "events.emit": (request) => answered(eventsEmit, request, step),
    spend: (request) => answered(spend, request, step),
  };
}
