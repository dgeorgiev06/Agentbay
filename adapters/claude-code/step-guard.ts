import { lstatSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import process from "node:process";
import { decide, type Decision } from "./guard-decide.ts";
import { readPolicy } from "./guard-input.ts";
import type { PathFacts, PathState } from "./guard-paths.ts";

const maximumPayloadBytes = 32 * 1024 * 1024;

function inspect(path: string): PathState {
  try {
    return { kind: "exists", realPath: realpathSync.native(path) };
  } catch {
    return lstatSync(path, { throwIfNoEntry: false }) === undefined ? { kind: "missing" } : { kind: "unresolvable" };
  }
}

const nodeFacts: PathFacts = { inspect };

function projectArgument(argumentsGiven: readonly string[]): string | undefined {
  const index = argumentsGiven.indexOf("--project");
  const value = index === -1 ? undefined : argumentsGiven[index + 1];
  return value !== undefined && isAbsolute(value) ? value : undefined;
}

function readOptionalText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return undefined;
  }
}

type PayloadText =
  { readonly kind: "parsed"; readonly payload: unknown } | { readonly kind: "unreadable"; readonly why: string };

function parsedPayload(text: string): PayloadText {
  try {
    const payload: unknown = JSON.parse(text);
    return { kind: "parsed", payload };
  } catch {
    return { kind: "unreadable", why: "the payload is not JSON" };
  }
}

async function readStandardInput(): Promise<PayloadText> {
  const pieces: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += piece.length;
    if (size > maximumPayloadBytes) {
      return { kind: "unreadable", why: `the payload has more than ${String(maximumPayloadBytes)} bytes` };
    }
    pieces.push(piece);
  }
  return parsedPayload(Buffer.concat(pieces).toString("utf8"));
}

function refusal(why: string): Decision {
  return { verdict: "deny", reason: `agentbay denied this tool call: ${why}, so the hook fails closed.` };
}

async function decision(): Promise<Decision> {
  const root = projectArgument(process.argv.slice(2));
  const script = process.argv[1];
  if (root === undefined || script === undefined) {
    return refusal("the hook was started without an absolute --project folder");
  }
  const input = await readStandardInput();
  if (input.kind === "unreadable") {
    return refusal(input.why);
  }
  const kit = resolve(dirname(script), "..", "..");
  const policy = readPolicy(readOptionalText(join(root, ".agentbay", "steps.json")), root);
  return decide({ root, kit, policy }, input.payload, nodeFacts);
}

function report(outcome: Decision): void {
  if (outcome.verdict === "allow") {
    return;
  }
  const output = {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: outcome.reason,
    },
  };
  process.stdout.write(`${JSON.stringify(output)}\n`);
  process.stderr.write(`${outcome.reason}\n`);
  process.exitCode = 2;
}

try {
  report(await decision());
} catch (error) {
  report(refusal(`the hook failed (${error instanceof Error ? error.message : String(error)})`));
}
