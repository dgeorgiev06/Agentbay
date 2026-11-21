import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import type { Effect, Json, RunEvent } from "../bay/contracts.ts";
import { fieldOf } from "../bay/json.ts";
import { loadKernel, type Kernel } from "../bay/kernel.ts";
import { nodeKernelPorts } from "../bay/kernel-ports.ts";
import { layoutOf } from "../bay/layout.ts";
import type { Run } from "../bay/runs/runs.ts";
import { listOf } from "./cli-fixture.ts";
import { testEnvironment } from "./kernel-fixture.ts";

const everyEffect: readonly Effect[] = ["read", "write", "network", "spend", "delete"];

export const secretName = "PROBE_TOKEN";

export const secretValue = "probe-token-5d1e8b7c4a";

const anything = `${JSON.stringify({ type: "object" })}\n`;

const commandScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  "  const secret = input.withSecret === true ? await context.secrets.get(input.secretName) : undefined;",
  "  const filled = (text) => (secret?.ok === true ? text.replaceAll('{secret}', secret.value) : text);",
  "  const answers = [];",
  "  for (const request of input.requests) {",
  "    const given = Array.isArray(request.arguments) ? request.arguments.map(filled) : request.arguments;",
  "    answers.push(await context.commands.run({ ...request, arguments: given }));",
  "  }",
  "  const leaks = answers.map((answer) => secret?.ok === true && JSON.stringify(answer).includes(secret.value));",
  '  return { answers, leaks, after: "the script went on" };',
  "});",
  "",
].join("\n");

export type Listed = {
  readonly run: string;
  readonly effects?: readonly Effect[];
};

export type CommandMode = {
  readonly startWith?: string;
  readonly commands: Readonly<Record<string, Listed>>;
  readonly effects?: readonly Effect[];
  readonly tier?: "base" | "modes";
};

export type CommandKit = {
  readonly root: string;
  readonly manifest: string;
  readonly remove: () => Promise<void>;
};

async function written(root: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text, "utf8");
}

function listedCommands(commands: Readonly<Record<string, Listed>>): Json {
  return Object.fromEntries(
    Object.entries(commands).map(([name, listed]) => [
      name,
      { run: listed.run, effects: [...(listed.effects ?? everyEffect)] },
    ]),
  );
}

export async function makeCommandKit(mode: CommandMode): Promise<CommandKit> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentbay-commands-")));
  const folder = `components/${mode.tier ?? "base"}/command-prober`;
  const manifest = {
    name: "command-prober",
    version: "1.0.0",
    description: "Runs the commands a test asks for.",
    resources: {
      ...(mode.startWith === undefined ? {} : { commandsStartWith: mode.startWith }),
      commands: listedCommands(mode.commands),
      secrets: [secretName],
    },
    actions: {
      go: {
        description: "When a test runs commands.",
        input: "schemas/anything.json",
        output: "schemas/anything.json",
        effects: [...(mode.effects ?? everyEffect)],
        run: [{ script: "scripts/go.ts" }],
      },
    },
  };
  await written(root, "agentbay.config.yaml", stringify({ bindings: {}, adapter: "fake" }));
  await written(root, `${folder}/mode.yaml`, stringify(manifest));
  await written(root, `${folder}/schemas/anything.json`, anything);
  await written(root, `${folder}/scripts/go.ts`, commandScript);
  return {
    root,
    manifest: join(root, folder, "mode.yaml"),
    remove: () => rm(root, { recursive: true, force: true }),
  };
}

export async function openCommandKernel(
  kit: CommandKit,
  environment: Readonly<Record<string, string>> = {},
): Promise<Kernel> {
  const given = { ...testEnvironment, ...environment };
  const loaded = await loadKernel({
    layout: layoutOf({ kit: kit.root, project: kit.root }),
    ports: nodeKernelPorts(given),
    environment: given,
    platform: "linux",
  });
  assert.ok(loaded.ok, loaded.ok ? "" : JSON.stringify(loaded.problems, null, 2));
  return loaded.value;
}

export type CommandAsked = {
  readonly name: Json;
  readonly arguments?: Json;
  readonly folder?: Json;
  readonly timeLimitSeconds?: Json;
  readonly input?: Json;
};

export type Ran = {
  readonly run: Run;
  readonly answers: readonly Json[];
  readonly leaks: readonly Json[];
  readonly after: Json;
};

export async function ranCommands(
  kernel: Kernel,
  requests: readonly CommandAsked[],
  options: { readonly withSecret?: boolean } = {},
): Promise<Ran> {
  const filled = requests.map((request) => ({ arguments: [], folder: ".", timeLimitSeconds: 30, ...request }));
  const input = { requests: filled, withSecret: options.withSecret === true, secretName };
  const started = await kernel.runs.start({ action: "command-prober.go" }, input);
  assert.ok(started.ok, JSON.stringify(started));
  const run = started.value;
  assert.ok(run.state.status === "done", JSON.stringify(run.state));
  const output = run.state.output;
  return {
    run,
    answers: listOf(fieldOf(output, "answers")),
    leaks: listOf(fieldOf(output, "leaks")),
    after: fieldOf(output, "after") ?? null,
  };
}

export async function withCommandKernel(
  mode: CommandMode,
  body: (kernel: Kernel, kit: CommandKit) => Promise<void>,
  environment: Readonly<Record<string, string>> = {},
): Promise<void> {
  const kit = await makeCommandKit(mode);
  try {
    const kernel = await openCommandKernel(kit, environment);
    try {
      await body(kernel, kit);
    } finally {
      kernel.close();
    }
  } finally {
    await kit.remove();
  }
}

export function eventsOfKind(run: Run, kind: string): readonly RunEvent[] {
  return run.events.filter((event) => event.kind === kind);
}

export function isRunning(pid: number): boolean {
  try {
    const state = readFileSync(`/proc/${String(pid)}/stat`, "utf8").split(" ")[2];
    return state !== "Z" && state !== "X";
  } catch {
    return false;
  }
}
