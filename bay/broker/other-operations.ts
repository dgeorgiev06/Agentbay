import { granted, listed, manifestOf } from "../answers.ts";
import type { Json } from "../contracts.ts";
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

export type OtherOperationName = Extract<OperationName, "secrets.get" | "events.emit">;

type DeclaredSecret = { readonly secret: string };

type ScriptEvent = { readonly eventKind: string; readonly detail: Json };

const brokerKinds: readonly string[] = ["refused", "http", "redacted", "command", "throwaway"];

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

export function otherEntries(step: Step): Entries<OtherOperationName> {
  return {
    "secrets.get": (request) => answered(secretsGet, request, step),
    "events.emit": (request) => answered(eventsEmit, request, step),
  };
}
