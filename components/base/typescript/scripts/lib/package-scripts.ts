import type { ScriptContext } from "../../../../../bay/sdk.ts";
import type { AgreedScript } from "./checks.ts";
import { runTimed } from "./commands.ts";

export type PackageScripts =
  | { readonly kind: "listed"; readonly names: ReadonlySet<string> }
  | { readonly kind: "absent" }
  | { readonly kind: "not json" };

export type CheckoutScripts = PackageScripts | { readonly kind: "not started"; readonly reason: string };

export type Readiness =
  | { readonly kind: "set up" }
  | { readonly kind: "not set up"; readonly reason: string }
  | { readonly kind: "not started"; readonly reason: string };

export type Place = "project" | "checkout";

const owners: Readonly<Record<Place, string>> = { project: "The project", checkout: "The checkout" };

const packageFile = "package.json";

function parsed(text: string): { readonly ok: true; readonly value: unknown } | { readonly ok: false } {
  try {
    const value: unknown = JSON.parse(text);
    return { ok: true, value };
  } catch {
    return { ok: false };
  }
}

function isRunnable(command: unknown): boolean {
  return typeof command === "string" && command.trim() !== "";
}

function scriptNames(manifest: unknown): readonly string[] {
  const scripts: unknown =
    typeof manifest === "object" && manifest !== null ? Reflect.get(manifest, "scripts") : undefined;
  if (typeof scripts !== "object" || scripts === null || Array.isArray(scripts)) {
    return [];
  }
  return Object.entries(scripts).flatMap(([name, command]: readonly [string, unknown]) =>
    isRunnable(command) ? [name] : [],
  );
}

export function scriptsOfText(text: string): PackageScripts {
  const read = parsed(text);
  if (!read.ok) {
    return { kind: "not json" };
  }
  return { kind: "listed", names: new Set(scriptNames(read.value)) };
}

export async function projectScripts(context: ScriptContext): Promise<PackageScripts> {
  const read = await context.files.read(packageFile);
  return read.ok ? scriptsOfText(read.value) : { kind: "absent" };
}

export async function checkoutScripts(
  context: ScriptContext,
  request: { readonly folder: string; readonly timeLimitSeconds: number },
): Promise<CheckoutScripts> {
  const finished = await runTimed(context, { ...request, name: "read-package", arguments: [] });
  const ending = finished.ending;
  switch (ending.how) {
    case "not-started":
      return { kind: "not started", reason: ending.reason };
    case "timed-out":
    case "signalled":
      return { kind: "not started", reason: `Reading ${packageFile} was stopped before it ended.` };
    case "exited":
      return ending.exitCode === 0 ? scriptsOfText(finished.stdout) : { kind: "absent" };
  }
}

export function hasScript(found: CheckoutScripts, script: AgreedScript): boolean {
  return found.kind === "listed" && found.names.has(script.name);
}

function lacking(place: Place, found: PackageScripts, name: string): string {
  const owner = owners[place];
  switch (found.kind) {
    case "listed":
      return `${owner}'s ${packageFile} has no script ${name}`;
    case "absent":
      return `${owner} has no ${packageFile}`;
    case "not json":
      return `${owner}'s ${packageFile} is not JSON, so the mode cannot tell whether it has the script ${name}`;
  }
}

function whatToAdd(found: PackageScripts, entry: string): string {
  switch (found.kind) {
    case "listed":
      return `add ${entry} to its scripts`;
    case "absent":
      return `add one with ${entry} in its scripts`;
    case "not json":
      return `make it JSON, with ${entry} in its scripts`;
  }
}

function optionalTail(found: PackageScripts, name: string): string {
  switch (found.kind) {
    case "listed":
      return ", which only some projects have";
    case "absent":
      return `, so it has no script ${name}`;
    case "not json":
      return "";
  }
}

export function notSetUpReason(place: Place, script: AgreedScript, found: PackageScripts): string {
  const need = script.need;
  const lacks = lacking(place, found, script.name);
  if (need.kind === "optional") {
    return `${lacks}${optionalTail(found, script.name)}.`;
  }
  const entry = `"${script.name}": "${need.example}"`;
  return `${lacks}: ${whatToAdd(found, entry)}, or another command that ${need.does}.`;
}

export function readinessOf(script: AgreedScript, found: CheckoutScripts): Readiness {
  if (found.kind === "not started") {
    return found;
  }
  return hasScript(found, script)
    ? { kind: "set up" }
    : { kind: "not set up", reason: notSetUpReason("checkout", script, found) };
}
