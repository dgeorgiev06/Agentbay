import { refusedResult, succeeded, usageResult, type CommandResult, type Invocation } from "../command-context.ts";
import type { Command } from "../command-line.ts";
import { secretStoreOf } from "../kernel.ts";
import { secretNamePattern } from "../policy.ts";

type Action = "set" | "check";

const usage = "secret set <NAME> | secret check <NAME>";

function environmentHint(name: string): string {
  return `Set AGENTBAY_SECRET_${name} in the environment that runs bay, for example in your shell profile.`;
}

function setSecret(invocation: Invocation, name: string): Promise<CommandResult> {
  const { context } = invocation;
  if (context.platform !== "darwin") {
    return Promise.resolve(
      refusedResult(
        `bay secret set stores secrets in the macOS keychain, and this is ${context.platform}.`,
        environmentHint(name),
      ),
    );
  }
  const command = `security add-generic-password -U -s agentbay -a ${name} -w`;
  const text = [
    "Run this yourself in a terminal; it asks for the value and does not echo it:",
    `  ${command}`,
    `Then bay secret check ${name} says whether agentbay can find it.`,
  ].join("\n");
  return Promise.resolve(succeeded({ name, stored: false, command }, text));
}

async function checkSecret(invocation: Invocation, name: string): Promise<CommandResult> {
  const { context } = invocation;
  const secrets = secretStoreOf({ ports: context.ports, environment: context.environment, platform: context.platform });
  const answer = await secrets.lookUp(name);
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
