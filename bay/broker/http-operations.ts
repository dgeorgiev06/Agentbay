import { type Answer, failed, granted, listed, manifestOf, type RefusalWording, refused } from "../answers.ts";
import type { HttpRequest, HttpResponse } from "../ports.ts";
import { checkUrl, type Hop, loggedHeaders, nextRequest, redirectTarget, type UrlCheck } from "./http-access.ts";
import type { OperationName } from "./operations.ts";
import {
  allowedWith,
  answered,
  type Asking,
  askingSentence,
  type Definition,
  type Doing,
  type Entries,
  type Need,
  noRefusalDetail,
  refusedWith,
  type Ruling,
  type Step,
} from "./rule.ts";

type HttpOperationName = Extract<OperationName, "http.request">;

type RefusedUrl = Exclude<UrlCheck, { readonly status: "allowed" }>;

type CheckedRequest = {
  readonly first: HttpRequest;
  readonly redirect: (target: string) => Ruling<string>;
  readonly redirects: number;
  readonly responseBytes: number;
};

const usesNetwork: Need = { effect: "network", because: "A request over the network needs the network effect" };

function urlRule(check: RefusedUrl, asking: Asking): Pick<RefusalWording, "declared" | "change"> {
  const { grants } = asking;
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
        declared: `the mode ${grants.mode} declares the hosts: ${listed(grants.hosts, "none")}`,
        change: `To allow it, add ${check.url.hostname} under resources.network in ${manifestOf(grants)}.`,
      };
  }
}

function urlRefusal(check: RefusedUrl, asking: Asking, redirected: boolean): Ruling<never> {
  const target = check.status === "not-a-url" ? "something that is not a URL" : check.url.href;
  const asked = redirected ? `A request was redirected to ${target}` : `${askingSentence(asking)} for ${target}`;
  return refusedWith({ resource: "http", asked, ...urlRule(check, asking) });
}

function redirectRule(asking: Asking): (target: string) => Ruling<string> {
  return (target) => {
    const check = checkUrl(target, asking.grants.hosts);
    return check.status === "allowed" ? allowedWith(target) : urlRefusal(check, asking, true);
  };
}

async function sentOnce(request: HttpRequest, doing: Doing): Promise<Answer<HttpResponse>> {
  let response: HttpResponse;
  try {
    response = await doing.http.request(request);
  } catch (error) {
    return failed(`The request to ${request.url} failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  await doing.record("http", {
    step: doing.stepKey,
    method: request.method,
    url: request.url,
    headers: loggedHeaders(request.headers),
    status: response.status,
  });
  return granted(response);
}

function capped(response: HttpResponse, responseBytes: number): Answer<HttpResponse> {
  const size = Buffer.byteLength(response.body);
  if (size > responseBytes) {
    return failed(`The response is ${String(size)} bytes, more than ${String(responseBytes)} bytes.`);
  }
  return granted(response);
}

const httpRequest: Definition<"http.request", CheckedRequest> = {
  operation: "http.request",
  needs: () => [usesNetwork],
  described: (request) => `send a ${request.method} request to ${request.url}`,
  rule: (request, asking) => {
    const size = Buffer.byteLength(request.body ?? "");
    if (size > asking.limits.httpRequestBytes) {
      return Promise.resolve(
        refusedWith({
          resource: "http",
          asked: `${askingSentence(asking)} to send a request body of ${String(size)} bytes`,
          declared: `the broker sends at most ${String(asking.limits.httpRequestBytes)} bytes`,
          change: "Send a smaller body; no manifest line raises this cap.",
        }),
      );
    }
    const check = checkUrl(request.url, asking.grants.hosts);
    if (check.status !== "allowed") {
      return Promise.resolve(urlRefusal(check, asking, false));
    }
    const limits = { redirects: asking.limits.httpRedirects, responseBytes: asking.limits.httpResponseBytes };
    return Promise.resolve(allowedWith({ first: request, redirect: redirectRule(asking), ...limits }));
  },
  handler: async (checked, doing) => {
    let current = checked.first;
    for (let hops = 0; hops <= checked.redirects; hops += 1) {
      const response = await sentOnce(current, doing);
      if (!response.ok) {
        return response;
      }
      const hop: Hop = { request: current, response: response.value };
      const target = redirectTarget(hop);
      if (target === undefined) {
        return capped(response.value, checked.responseBytes);
      }
      if (hops === checked.redirects) {
        break;
      }
      const ruled = checked.redirect(target);
      if (!ruled.allowed) {
        return refused(ruled.refusal);
      }
      current = nextRequest(hop, ruled.value);
    }
    return failed(`The request was redirected more than ${String(checked.redirects)} times.`);
  },
  refusalDetail: noRefusalDetail,
};

export function httpEntries(step: Step): Entries<HttpOperationName> {
  return {
    "http.request": (request) => answered(httpRequest, request, step),
  };
}
