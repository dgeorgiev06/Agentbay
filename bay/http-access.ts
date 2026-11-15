import type { HttpRequest, HttpResponse } from "./ports.ts";

export type UrlCheck =
  | { readonly status: "allowed"; readonly url: URL }
  | { readonly status: "not-a-url" }
  | { readonly status: "not-https"; readonly url: URL }
  | { readonly status: "undeclared-host"; readonly url: URL }
  | { readonly status: "other-port"; readonly url: URL }
  | { readonly status: "credentials-in-url"; readonly url: URL };

export type Hop = {
  readonly request: HttpRequest;
  readonly response: HttpResponse;
};

const redirectStatuses: readonly number[] = [301, 302, 303, 307, 308];

const sensitiveHeaderName = /authorization|cookie|token|secret|key|session|password|signature|credential/i;

export function hostAllowed(host: string, declared: readonly string[]): boolean {
  const name = host.toLowerCase();
  return declared.some((entry) => {
    const pattern = entry.toLowerCase();
    if (pattern.startsWith("*.")) {
      return name.endsWith(pattern.slice(1)) && name.length > pattern.length - 1;
    }
    return name === pattern;
  });
}

export function checkUrl(text: string, hosts: readonly string[]): UrlCheck {
  if (!URL.canParse(text)) {
    return { status: "not-a-url" };
  }
  const url = new URL(text);
  if (url.protocol !== "https:") {
    return { status: "not-https", url };
  }
  if (url.username !== "" || url.password !== "") {
    return { status: "credentials-in-url", url };
  }
  if (!hostAllowed(url.hostname, hosts)) {
    return { status: "undeclared-host", url };
  }
  if (url.port !== "") {
    return { status: "other-port", url };
  }
  return { status: "allowed", url };
}

export function redirectTarget(hop: Hop): string | undefined {
  if (!redirectStatuses.includes(hop.response.status)) {
    return undefined;
  }
  const location = Object.entries(hop.response.headers).find(([name]) => name.toLowerCase() === "location")?.[1];
  if (location === undefined || !URL.canParse(location, hop.request.url)) {
    return undefined;
  }
  return new URL(location, hop.request.url).href;
}

function withoutCredentials(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !sensitiveHeaderName.test(name)));
}

export function nextRequest(hop: Hop, target: string): HttpRequest {
  const sameHost = new URL(target).host === new URL(hop.request.url).host;
  const headers = sameHost ? hop.request.headers : withoutCredentials(hop.request.headers);
  const keepsMethod = hop.response.status === 307 || hop.response.status === 308;
  if (keepsMethod && hop.request.body !== undefined) {
    return { method: hop.request.method, url: target, headers, body: hop.request.body };
  }
  return { method: keepsMethod ? hop.request.method : "GET", url: target, headers };
}

export function loggedHeaders(headers: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name, sensitiveHeaderName.test(name) ? "[redacted]" : value]),
  );
}
