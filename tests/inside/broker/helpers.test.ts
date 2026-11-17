import assert from "node:assert/strict";
import { test } from "node:test";
import { checkPath } from "../../../bay/broker/file-access.ts";
import { checkUrl, loggedHeaders, nextRequest, redirectTarget } from "../../../bay/broker/http-access.ts";
import { isOneStatement, leadingKeyword } from "../../../bay/broker/sql-statements.ts";
import { isInsideOrEqual, layoutOf } from "../../../bay/layout.ts";
import type { FileInspector } from "../../../bay/ports.ts";

function reaches(host: string, declared: readonly string[]): boolean {
  return checkUrl(`https://${host}/x`, declared).status === "allowed";
}

test("the leading keyword skips blanks and comments, and one statement may end in a semicolon and comments", () => {
  assert.equal(leadingKeyword("  -- note\n /* block */ ATTACH 'x' as y"), "attach");
  assert.equal(leadingKeyword("/* never closed"), "");
  assert.equal(leadingKeyword("select 1"), "select");
  assert.equal(isOneStatement("select 1; -- done\n", "select 1;"), true);
  assert.equal(isOneStatement("select 1; delete from t", "select 1;"), false);
  assert.equal(isOneStatement("select 2", "select 1"), false);
});

test("a host matches exactly, or under a leading *. entry, in any letter case", () => {
  assert.equal(reaches("API.example.com", ["api.example.com"]), true);
  assert.equal(reaches("a.example.com", ["*.example.com"]), true);
  assert.equal(reaches("example.com", ["*.example.com"]), false);
  assert.equal(reaches("badexample.com", ["*.example.com"]), false);
  assert.equal(reaches("anything", []), false);
});

test("a URL is checked for scheme, credentials, host and port", () => {
  const hosts = ["api.example.com"];
  assert.equal(checkUrl("https://api.example.com/x", hosts).status, "allowed");
  assert.equal(checkUrl("https://api.example.com:443/x", hosts).status, "allowed");
  assert.equal(checkUrl("nonsense", hosts).status, "not-a-url");
  assert.equal(checkUrl("http://api.example.com/x", hosts).status, "not-https");
  assert.equal(checkUrl("https://u:p@api.example.com/x", hosts).status, "credentials-in-url");
  assert.equal(checkUrl("https://other.example/x", hosts).status, "undeclared-host");
  assert.equal(checkUrl("https://api.example.com:8443/x", hosts).status, "other-port");
});

test("a redirect is read from the location header, and the next request drops credentials across hosts", () => {
  const request = {
    method: "POST" as const,
    url: "https://a.example/x",
    headers: { Authorization: "t", Accept: "*" },
    body: "b",
  };
  const moved = { status: 307, headers: { Location: "https://b.example/y" }, body: "" };
  assert.equal(redirectTarget({ request, response: moved }), "https://b.example/y");
  assert.equal(redirectTarget({ request, response: { status: 200, headers: {}, body: "" } }), undefined);
  assert.deepEqual(nextRequest({ request, response: moved }, "https://b.example/y"), {
    method: "POST",
    url: "https://b.example/y",
    headers: { Accept: "*" },
    body: "b",
  });
  const seeOther = { status: 303, headers: { location: "/z" }, body: "" };
  assert.deepEqual(nextRequest({ request, response: seeOther }, "https://a.example/z"), {
    method: "GET",
    url: "https://a.example/z",
    headers: { Authorization: "t", Accept: "*" },
  });
  assert.deepEqual(loggedHeaders({ Authorization: "t", Cookie: "c", "X-Session-Id": "s", Accept: "*" }), {
    Authorization: "[redacted]",
    Cookie: "[redacted]",
    "X-Session-Id": "[redacted]",
    Accept: "*",
  });
});

test("a path check resolves links on the deepest existing ancestor", async () => {
  const links = new Map([["/root/in/link", "/elsewhere"]]);
  const inspector: FileInspector = {
    realPath: (path) => {
      for (const [link, target] of links) {
        if (isInsideOrEqual(path, link)) {
          return Promise.resolve(target + path.slice(link.length));
        }
      }
      return Promise.resolve(["/root", "/root/in", "/root/out"].includes(path) ? path : undefined);
    },
    isLink: (path) => Promise.resolve(links.has(path)),
    entries: () => Promise.resolve([]),
  };
  const layout = layoutOf({ kit: "/root", project: "/root" });
  const request = { layout, permitted: ["/root/in"], purpose: "read" as const };
  assert.deepEqual(await checkPath(inspector, { ...request, path: "in/new/file.txt" }), {
    status: "allowed",
    path: "/root/in/new/file.txt",
  });
  assert.equal((await checkPath(inspector, { ...request, path: "in/link/x" })).status, "through-link");
  assert.equal((await checkPath(inspector, { ...request, path: "out/x" })).status, "outside");
  assert.equal(isInsideOrEqual("/root/inside", "/root/in"), false);
});

test("an exact host entry matches only that host, never a host that merely ends with it", () => {
  for (const host of ["evil-api.example.com", "notapi.example.com", "api.example.com.evil.test", "xapi.example.com"]) {
    assert.equal(reaches(host, ["api.example.com"]), false, host);
  }
  assert.equal(reaches("api.example.com", ["api.example.com"]), true);
});

test("a wildcard entry matches subdomains at any depth, but not the bare domain or look-alikes", () => {
  const declared = ["*.example.com"];
  assert.equal(reaches("a.example.com", declared), true);
  assert.equal(reaches("a.b.example.com", declared), true);
  for (const host of ["example.com", "evilexample.com", "example.com.evil.test"]) {
    assert.equal(reaches(host, declared), false, host);
  }
});

test("a URL is decided on the host the request would really reach", () => {
  const hosts = ["api.example.com"];
  assert.equal(checkUrl("https://API.EXAMPLE.COM/x", hosts).status, "allowed");
  assert.equal(checkUrl("https://api.example.com./x", hosts).status, "undeclared-host");
  assert.equal(checkUrl("https://api.example.com:8443/x", hosts).status, "other-port");
  const userinfo = checkUrl("https://api.example.com@evil.test/", hosts);
  assert.notEqual(userinfo.status, "allowed");
  assert.equal(userinfo.status === "not-a-url" ? "" : userinfo.url.hostname, "evil.test");
  assert.equal(reaches("evil.test", hosts), false);
  assert.equal(checkUrl("https://93.184.216.34/x", hosts).status, "undeclared-host");
  assert.equal(checkUrl("https://93.184.216.34/x", ["*.184.216.34"]).status, "undeclared-host");
  assert.equal(checkUrl("https://[::1]/x", hosts).status, "undeclared-host");
});

test("a path check resolves relative paths in the project and judges a kit folder against the kit", async () => {
  const links = new Map([["/kit/components/modes/notes/link", "/kit/bay"]]);
  const inspector: FileInspector = {
    realPath: (path) => {
      for (const [link, target] of links) {
        if (isInsideOrEqual(path, link)) {
          return Promise.resolve(target + path.slice(link.length));
        }
      }
      return Promise.resolve(["/kit", "/p", "/kit/components/modes/notes", "/p/out"].includes(path) ? path : undefined);
    },
    isLink: (path) => Promise.resolve(links.has(path)),
    entries: () => Promise.resolve([]),
  };
  const layout = layoutOf({ kit: "/kit", project: "/p" });
  const permitted = ["/kit/components/modes/notes", "/p/out"];
  const request = { layout, permitted, purpose: "read" as const };
  const own = await checkPath(inspector, { ...request, path: "/kit/components/modes/notes/a.md" });
  assert.deepEqual(own, { status: "allowed", path: "/kit/components/modes/notes/a.md" });
  assert.deepEqual(await checkPath(inspector, { ...request, path: "out/x.md" }), {
    status: "allowed",
    path: "/p/out/x.md",
  });
  assert.equal((await checkPath(inspector, { ...request, path: "/kit/bay/sdk.ts" })).status, "outside");
  const linked = await checkPath(inspector, { ...request, path: "/kit/components/modes/notes/link/sdk.ts" });
  assert.equal(linked.status, "through-link");
});
