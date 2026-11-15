import { fail, parseIsoTime, type Json } from "../../../../../bay/sdk.ts";
import { fixturePosts, type FixturePost } from "./posts.ts";

export const sourceName = "fake";

export const sourceKinds: readonly string[] = ["post"];

export const nativeFields: readonly string[] = ["authors", "since", "until", "limit"];

type Fields = { readonly [key: string]: Json };

export type Settings = {
  readonly baseDate: Date;
  readonly pageSize: number;
  readonly costPerItemUsd: number;
};

export type Post = {
  readonly id: string;
  readonly kind: string;
  readonly source: string;
  readonly at: string;
  readonly title: null;
  readonly text: string;
  readonly url: string | null;
  readonly author: string;
  readonly labels: readonly string[];
  readonly data: { readonly likes: number };
};

type Native = {
  readonly authors: readonly string[];
  readonly since: number | undefined;
  readonly until: number | undefined;
  readonly limit: number | undefined;
};

export type Page = {
  readonly posts: readonly Post[];
  readonly cursor: string | null;
  readonly more: boolean;
};

const defaultPageSize = 10;

const defaultCostPerItemUsd = 0.001;

const hourMilliseconds = 3_600_000;

function isFields(value: Json | undefined): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

function timeOf(value: Json | undefined): number | undefined {
  return typeof value === "string" ? parseIsoTime(value)?.getTime() : undefined;
}

export function settingsOf(settings: Readonly<Record<string, Json>>): Settings {
  const baseDate = typeof settings.baseDate === "string" ? parseIsoTime(settings.baseDate) : undefined;
  if (baseDate === undefined) {
    return fail("fake-source needs settings.fake-source.baseDate, an ISO 8601 time the fixture posts lead up to.");
  }
  const pageSize = typeof settings.pageSize === "number" ? settings.pageSize : defaultPageSize;
  const cost = typeof settings.costPerItemUsd === "number" ? settings.costPerItemUsd : defaultCostPerItemUsd;
  return { baseDate, pageSize, costPerItemUsd: cost };
}

function postOf(fixture: FixturePost, baseDate: Date): Post {
  const at = new Date(baseDate.getTime() - fixture.hoursBefore * hourMilliseconds).toISOString();
  const number = String(fixture.number);
  return {
    id: `${sourceName}:${number}`,
    kind: "post",
    source: sourceName,
    at,
    title: null,
    text: fixture.text,
    url: fixture.linked ? `https://fake.example/${fixture.author}/status/${number}` : null,
    author: fixture.author,
    labels: fixture.labels,
    data: { likes: fixture.likes },
  };
}

function nativeOf(selector: Json | undefined): Native {
  const fields = isFields(selector) ? selector : {};
  const authors = isList(fields.authors)
    ? fields.authors.flatMap((name) => (typeof name === "string" ? [name] : []))
    : [];
  return {
    authors: authors.some((name) => name.includes("*")) ? [] : authors.map(normalName),
    since: timeOf(fields.since),
    until: timeOf(fields.until),
    limit: typeof fields.limit === "number" ? fields.limit : undefined,
  };
}

function normalName(name: string): string {
  return name.trim().toLowerCase().replace(/^@/, "");
}

function cursorOf(post: Post): string {
  return `${post.at}|${post.id}`;
}

function isAfter(post: Post, cursor: string | null): boolean {
  return cursor === null || cursorOf(post) > cursor;
}

function nativeMatches(native: Native, post: Post): boolean {
  const at = new Date(post.at).getTime();
  const authorMatches = native.authors.length === 0 || native.authors.includes(normalName(post.author));
  const sinceMatches = native.since === undefined || at >= native.since;
  const untilMatches = native.until === undefined || at < native.until;
  return authorMatches && sinceMatches && untilMatches;
}

const cursorPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|fake:\d+$/;

export function pageOf(request: Json, settings: Settings): Page {
  const fields = isFields(request) ? request : {};
  const cursor = typeof fields.cursor === "string" ? fields.cursor : null;
  if (cursor !== null && !cursorPattern.test(cursor)) {
    return fail(`The cursor ${JSON.stringify(cursor)} was not made by fake-source; fetch again with cursor null.`);
  }
  const native = nativeOf(fields.selector);
  const size = Math.max(1, Math.min(settings.pageSize, native.limit ?? settings.pageSize));
  const waiting = fixturePosts
    .map((fixture) => postOf(fixture, settings.baseDate))
    .sort((first, second) => (cursorOf(first) < cursorOf(second) ? -1 : 1))
    .filter((post) => isAfter(post, cursor) && nativeMatches(native, post));
  const posts = waiting.slice(0, size);
  const last = posts.at(-1);
  return { posts, cursor: last === undefined ? cursor : cursorOf(last), more: waiting.length > posts.length };
}

export function costOf(count: number, settings: Settings): { readonly items: number; readonly usd: number } {
  return { items: count, usd: Math.round(count * settings.costPerItemUsd * 1e9) / 1e9 };
}
