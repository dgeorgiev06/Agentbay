import { errorLine, failed, granted, listed, manifestOf } from "../answers.ts";
import type { Json } from "../contracts.ts";
import { isJsonRecord } from "../protocol-json.ts";
import { secretNamePattern } from "../policy.ts";
import type { OperationName } from "./operations.ts";
import {
  allowedWith,
  answered,
  askingSentence,
  type Definition,
  type Entries,
  type Need,
  noRefusalDetail,
  refusedWith,
  type SpendAmounts,
  type Step,
} from "./rule.ts";

type OtherOperationName = Extract<OperationName, "secrets.get" | "events.emit" | "spend" | "call" | "random">;

type DeclaredSecret = { readonly secret: string };

type ScriptEvent = { readonly eventKind: string; readonly detail: Json };

type CallToMake = { readonly target: string; readonly input: Json };

type RandomToDraw = { readonly checkedBytes: number };

const mostRandomBytes = 64;

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

function misfitsOf(spending: { readonly [key: string]: Json }): readonly string[] {
  return spendMeasures.flatMap((measure) => {
    const value = spending[measure];
    if (isAmount(value)) {
      return [];
    }
    return typeof value === "number"
      ? [`the field ${measure} is ${String(value)}`]
      : [`the field ${measure} is not a number`];
  });
}

function spendingAsked(spending: Json): string {
  if (!isJsonRecord(spending)) {
    return "The step reported spending that is not a mapping";
  }
  const misfits = misfitsOf(spending);
  const last = misfits.at(-1) ?? "";
  const named = misfits.length < 2 ? last : `${misfits.slice(0, -1).join(", ")} and ${last}`;
  return `The step reported spending in which ${named}`;
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
          asked: spendingAsked(request.spending),
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

const call: Definition<"call", CallToMake> = {
  operation: "call",
  needs: () => [],
  described: (request) => `call ${request.reference}`,
  rule: (request) => Promise.resolve(allowedWith({ target: request.reference, input: request.input })),
  handler: async (called, doing) => {
    try {
      const outcome = await doing.call(called.target, called.input);
      return outcome.status === "done" ? granted(outcome.output) : failed(outcome.reason);
    } catch (error) {
      return failed(`The call to ${called.target} stopped at an unexpected error: ${errorLine(error)}`);
    }
  },
  refusalDetail: noRefusalDetail,
};

function isRandomSize(bytes: number): boolean {
  return Number.isInteger(bytes) && bytes >= 1 && bytes <= mostRandomBytes;
}

const random: Definition<"random", RandomToDraw> = {
  operation: "random",
  needs: () => [],
  described: (request) => `draw ${String(request.bytes)} random bytes`,
  rule: (request, asking) => {
    if (isRandomSize(request.bytes)) {
      return Promise.resolve(allowedWith({ checkedBytes: request.bytes }));
    }
    return Promise.resolve(
      refusedWith({
        resource: "random",
        asked: `${askingSentence(asking)} for ${String(request.bytes)} random bytes in one value`,
        declared: `a value is a whole number of 1 to ${String(mostRandomBytes)} bytes`,
        change: `Ask for at most ${String(mostRandomBytes)}, and ask again for more.`,
      }),
    );
  },
  handler: async (asked, doing) => {
    const drawn = await doing.random(asked.checkedBytes);
    return drawn.status === "done" ? granted(drawn.value) : failed(drawn.reason);
  },
  refusalDetail: noRefusalDetail,
};

export function otherEntries(step: Step): Entries<OtherOperationName> {
  return {
    "secrets.get": (request) => answered(secretsGet, request, step),
    "events.emit": (request) => answered(eventsEmit, request, step),
    spend: (request) => answered(spend, request, step),
    call: (request) => answered(call, request, step),
    random: (request) => answered(random, request, step),
  };
}
