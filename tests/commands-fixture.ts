import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { stringify } from "yaml";
import type { Effect, Json } from "../bay/contracts.ts";
import { fieldOf } from "../bay/json.ts";
import { loadKernel, nodeKernelPorts, type Kernel } from "../bay/kernel.ts";
import { layoutOf } from "../bay/layout.ts";
import type { Run } from "../bay/runs/runs.ts";
import { listOf } from "./cli-fixture.ts";
import { testEnvironment } from "./kernel-fixture.ts";

const everyEffect: readonly Effect[] = ["read", "write", "network", "spend", "delete"];

const secretName = "PROBE_TOKEN";

const anything = `${JSON.stringify({ type: "object" })}\n`;

const commandScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  "  const secret = input.withSecret === true ? await context.secrets.get(input.secretName) : undefined;",
  "  const filled = (text) => (secret?.ok === true ? text.replaceAll('{secret}', secret.value) : text);",
  "  const answers = [];",
  "  for (const request of input.requests) {",
  "    const command = Array.isArray(request.command) ? request.command.map(filled) : request.command;",
  "    answers.push(await context.commands.run({ ...request, command }));",
  "  }",
  '  return { answers, after: "the script went on" };',
  "});",
  "",
].join("\n");

export type CommandMode = {
  readonly commands: readonly string[];
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

export async function makeCommandKit(mode: CommandMode): Promise<CommandKit> {
  const root = await realpath(await mkdtemp(join(tmpdir(), "agentbay-commands-")));
  const folder = `components/${mode.tier ?? "base"}/command-prober`;
  const manifest = {
    name: "command-prober",
    version: "1.0.0",
    description: "Runs the commands a test asks for.",
    resources: { commands: [...mode.commands], secrets: [secretName] },
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
  readonly command: Json;
  readonly folder?: Json;
  readonly timeLimitSeconds?: Json;
};

export type Ran = {
  readonly run: Run;
  readonly answers: readonly Json[];
  readonly after: Json;
};

export async function ranCommands(
  kernel: Kernel,
  requests: readonly CommandAsked[],
  options: { readonly withSecret?: boolean } = {},
): Promise<Ran> {
  const filled = requests.map((request) => ({ folder: ".", timeLimitSeconds: 30, ...request }));
  const input = { requests: filled, withSecret: options.withSecret === true, secretName };
  const started = await kernel.runs.start({ action: "command-prober.go" }, input);
  assert.ok(started.ok, JSON.stringify(started));
  const run = started.value;
  assert.ok(run.state.status === "done", JSON.stringify(run.state));
  const output = run.state.output;
  return { run, answers: listOf(fieldOf(output, "answers")), after: fieldOf(output, "after") ?? null };
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

export function isRunning(pid: number): boolean {
  try {
    const state = readFileSync(`/proc/${String(pid)}/stat`, "utf8").split(" ")[2];
    return state !== "Z" && state !== "X";
  } catch {
    return false;
  }
}
