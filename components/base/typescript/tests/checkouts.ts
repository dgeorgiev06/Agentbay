import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";

export type Files = Readonly<Record<string, string>>;

export type Scripts = Readonly<Record<string, string>>;

export function openToolchainProject(): Promise<ModeProject> {
  return openModeProject({ bindings: {}, adapter: "claude-code", modes: ["typescript"] });
}

export async function writeCheckout(project: ModeProject, name: string, files: Files): Promise<string> {
  const folder = join("checkouts", name);
  for (const [path, text] of Object.entries(files)) {
    const file = join(project.root, folder, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text, "utf8");
  }
  return folder;
}

export function packageWith(scripts: Scripts): string {
  return `${JSON.stringify({ name: "checkout", private: true, type: "module", scripts }, null, 2)}\n`;
}

export function printing(text: string): string {
  return `node -e "console.log('${text}')"`;
}

export function failingWith(text: string, exitCode: number): string {
  return `node -e "console.log('${text}'); process.exit(${String(exitCode)})"`;
}

export const hanging = 'node -e "setTimeout(() => {}, 600000)"';

export function hangingAfter(text: string): string {
  return `node -e "console.log('${text}'); setTimeout(() => {}, 600000)"`;
}

export function npmHeader(name: string, script: string): string {
  return `\n> ${name}\n> ${script}\n\n`;
}

export type Fields = { readonly [key: string]: Json };

function isFields(value: Json): value is Fields {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function withoutSeconds(value: Json): Fields {
  assert.ok(isFields(value), JSON.stringify(value));
  const { seconds, ...rest } = value;
  assert.equal(typeof seconds, "number", JSON.stringify(value));
  assert.ok(typeof seconds === "number" && seconds >= 0, JSON.stringify(value));
  return rest;
}

function isList(value: Json | undefined): value is readonly Json[] {
  return Array.isArray(value);
}

export function listed(value: Json, name: string): readonly Json[] {
  assert.ok(isFields(value), JSON.stringify(value));
  const list = value[name];
  assert.ok(isList(list), JSON.stringify(value));
  return list;
}

export function commandsRun(events: readonly { readonly kind: string; readonly detail: Json }[]): readonly Json[] {
  return events
    .filter((event) => event.kind === "command")
    .map((event) => (isFields(event.detail) ? (event.detail.command ?? null) : null));
}
