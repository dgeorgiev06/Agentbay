import { refusedResult, succeeded, usageResult, type CommandResult, type Invocation } from "../command-context.ts";
import type { Command } from "../command-line.ts";
import type { Permissions } from "../contracts.ts";
import { secretStoreOf } from "../kernel.ts";
import { secretNamePattern } from "../policy.ts";

type Action = "set" | "check";

const usage = "secret set <NAME> | secret check <NAME>";

const shortestValue = 8;

const keychainMilliseconds = 30_000;

function lookupPermissions(invocation: Invocation, name: string): Permissions {
  return {
    mode: "bay secret check",
    modeFolder: invocation.project,
    databaseFile: "",
    migrationsFolder: "",
    readPaths: [],
    writePaths: [],
    secrets: [name],
    hosts: [],
    commands: [],
    effects: ["read"],
  };
}

function environmentHint(name: string): string {
  return `Set AGENTBAY_SECRET_${name} in the environment that runs bay, for example in your shell profile.`;
}

async function setSecret(invocation: Invocation, name: string): Promise<CommandResult> {
  const { context } = invocation;
  if (context.platform !== "darwin") {
    return refusedResult(
      `bay secret set stores secrets in the macOS keychain, and this is ${context.platform}.`,
      environmentHint(name),
    );
  }
  if (!context.terminal.isInteractive()) {
    return refusedResult(
      "bay secret set needs an interactive terminal (stdin is not a TTY); it never reads a secret from a pipe, " +
        "an argument or --json, so an agent cannot set one. Run it yourself in a terminal.",
    );
  }
  const value = await context.terminal.askHidden(`${name} (input hidden): `);
  if (value.length < shortestValue) {
    return refusedResult(
      `The value is shorter than ${String(shortestValue)} characters, too short to redact safely; nothing was stored.`,
    );
  }
  const result = await context.ports.processes.run({
    command: "security",
    arguments: ["add-generic-password", "-U", "-s", "agentbay", "-a", name, "-w"],
    directory: "/",
    environment: {},
    timeoutMilliseconds: keychainMilliseconds,
    input: `${value}\n${value}\n`,
  });
  if (result.exitCode !== 0) {
    const reason = result.stderr.replaceAll(value, "[redacted]").trim();
    return refusedResult(`The keychain did not store ${name}: ${reason}`, environmentHint(name));
  }
  return succeeded({ name, stored: true }, `Stored ${name} in the macOS keychain (service agentbay).`);
}

async function checkSecret(invocation: Invocation, name: string): Promise<CommandResult> {
  const { context } = invocation;
  const secrets = secretStoreOf({ ports: context.ports, environment: context.environment, platform: context.platform });
  const answer = await secrets.get(name, lookupPermissions(invocation, name));
  if (answer.ok) {
    return succeeded({ name, found: true }, `${name} is set.`);
  }
  return { exitCode: 1, json: { ok: false, name, found: false, message: answer.message }, text: answer.message };
}

function actionOf(text: string): Action | undefined {
  return text === "set" || text === "check" ? text : undefined;
}

function runSecret(invocation: Invocation): Promise<CommandResult> {
  const [actionText = "", name = ""] = invocation.positionals;
  const action = actionOf(actionText);
  if (action === undefined || !secretNamePattern.test(name)) {
    const message =
      action === undefined
        ? `secret takes set or check, not ${actionText}.`
        : `${name} is not a secret name such as API_TOKEN.`;
    return Promise.resolve(usageResult(message, usage));
  }
  switch (action) {
    case "set":
      return setSecret(invocation, name);
    case "check":
      return checkSecret(invocation, name);
  }
}

export const secretCommand: Command = {
  name: "secret",
  summary: "Store a secret in the macOS keychain from an interactive terminal, or check that one can be found.",
  usage,
  options: [],
  positionals: { least: 2, most: 2 },
  handler: runSecret,
};
