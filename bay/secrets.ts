import { type Answer, failed, granted, listed, manifestOf, refused } from "./answers.ts";
import type { Json, ModeGrants } from "./contracts.ts";
import { secretNamePattern } from "./policy.ts";
import type { Processes } from "./ports.ts";
import { scrubSecretPatterns } from "./secret-patterns.ts";

export type SecretStoreOptions = {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly processes: Processes;
  readonly platform: string;
};

export type OpenSecretStoreOptions = SecretStoreOptions & {
  readonly declaredBy: readonly ModeGrants[];
};

type Form = {
  readonly text: string;
  readonly name: string;
};

const shortestValue = 8;

const keychainService = "agentbay";

const keychainMilliseconds = 10_000;

const environmentPrefix = "AGENTBAY_SECRET_";

function base64Cores(value: string): readonly string[] {
  const bytes = Buffer.from(value, "utf8");
  const cores: string[] = [bytes.toString("base64"), bytes.toString("base64url")];
  for (const shift of [0, 1, 2]) {
    const shifted = Buffer.concat([Buffer.alloc(shift), bytes]);
    const start = shift === 0 ? 0 : 4;
    const end = Math.floor(shifted.length / 3) * 4;
    const core = shifted.toString("base64").slice(start, end);
    if (core.length >= shortestValue) {
      cores.push(core, core.replaceAll("+", "-").replaceAll("/", "_"));
    }
  }
  return cores;
}

function encodedForms(value: string): readonly string[] {
  const formEncoded = new URLSearchParams({ value }).toString().slice("value=".length);
  const jsonEscaped = JSON.stringify(value).slice(1, -1);
  const hex = Buffer.from(value, "utf8").toString("hex");
  return [value, encodeURIComponent(value), formEncoded, jsonEscaped, hex, hex.toUpperCase(), ...base64Cores(value)];
}

function askedFor(name: string): string {
  return `The step asked for the secret ${name}`;
}

export class SecretStore {
  readonly #environment: Readonly<Record<string, string | undefined>>;
  readonly #processes: Processes;
  readonly #platform: string;
  readonly #forms = new Map<string, string>();

  constructor(options: SecretStoreOptions) {
    this.#environment = options.environment;
    this.#processes = options.processes;
    this.#platform = options.platform;
  }

  static async open(options: OpenSecretStoreOptions): Promise<SecretStore> {
    const store = new SecretStore(options);
    const declared = new Set(options.declaredBy.flatMap((grants) => grants.secrets));
    for (const name of [...declared].sort()) {
      await store.#learn(name);
    }
    return store;
  }

  async get(name: string, grants: ModeGrants): Promise<Answer<string>> {
    const asked = askedFor(name);
    if (!secretNamePattern.test(name)) {
      return refused({
        resource: "secrets",
        asked,
        declared: "secret names are made of upper-case letters, digits and underscores",
        change: `Rename the secret in resources.secrets in ${manifestOf(grants)} and where it is stored.`,
      });
    }
    if (!grants.secrets.includes(name)) {
      return refused({
        resource: "secrets",
        asked,
        declared: `the mode ${grants.mode} declares the secrets: ${listed(grants.secrets, "none")}`,
        change: `To allow it, add ${name} under resources.secrets in ${manifestOf(grants)}.`,
      });
    }
    return this.lookUp(name);
  }

  async lookUp(name: string): Promise<Answer<string>> {
    const asked = askedFor(name);
    const value = await this.#storedValue(name);
    if (value === undefined) {
      return failed(
        `The secret ${name} is not set. Set ${environmentPrefix}${name} in the environment, or on macOS store it ` +
          `with \`security add-generic-password -s ${keychainService} -a ${name} -w\`.`,
      );
    }
    if (value.length < shortestValue) {
      return refused({
        resource: "secrets",
        asked,
        declared: `its value is shorter than ${String(shortestValue)} characters, too short to redact safely`,
        change: `Store a value of at least ${String(shortestValue)} characters for ${name}.`,
      });
    }
    this.#remember(name, value);
    return granted(value);
  }

  redact(text: string): string {
    return scrubSecretPatterns(this.redactKnownValues(text));
  }

  redactKnownValues(text: string): string {
    let redacted = text;
    for (const form of this.#formsLongestFirst()) {
      redacted = redacted.replaceAll(form.text, `[redacted:${form.name}]`);
    }
    return redacted;
  }

  redactJson(value: Json): Json {
    if (typeof value === "string") {
      return this.redact(value);
    }
    if (value === null || typeof value !== "object") {
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item: Json) => this.redactJson(item));
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [this.redact(key), this.redactJson(item)]));
  }

  async #storedValue(name: string): Promise<string | undefined> {
    const fromEnvironment = this.#environment[`${environmentPrefix}${name}`];
    if (fromEnvironment !== undefined && fromEnvironment !== "") {
      return fromEnvironment;
    }
    if (this.#platform !== "darwin") {
      return undefined;
    }
    const result = await this.#processes.run({
      command: "security",
      arguments: ["find-generic-password", "-s", keychainService, "-a", name, "-w"],
      directory: "/",
      environment: {},
      timeoutMilliseconds: keychainMilliseconds,
    });
    const value = result.stdout.text.replace(/\r?\n$/, "");
    const succeeded = result.end.how === "exited" && result.end.exitCode === 0;
    return succeeded && value !== "" ? value : undefined;
  }

  async #learn(name: string): Promise<void> {
    const value = await this.#storedValue(name);
    if (value !== undefined && value.length >= shortestValue) {
      this.#remember(name, value);
    }
  }

  #remember(name: string, value: string): void {
    for (const form of encodedForms(value)) {
      this.#forms.set(form, name);
    }
  }

  #formsLongestFirst(): readonly Form[] {
    return [...this.#forms.entries()]
      .map(([text, name]) => ({ text, name }))
      .sort((first, second) => second.text.length - first.text.length);
  }
}
