import { isBuiltin, registerHooks, syncBuiltinESMExports } from "node:module";
import { Socket } from "node:net";
import { removalAllowedArgument, sdkSpecifier } from "./script-protocol.ts";

const availableBuiltins: ReadonlySet<string> = new Set([
  "assert",
  "assert/strict",
  "buffer",
  "crypto",
  "events",
  "fs",
  "fs/promises",
  "path",
  "path/posix",
  "path/win32",
  "querystring",
  "readline",
  "stream",
  "stream/consumers",
  "stream/promises",
  "stream/web",
  "string_decoder",
  "timers",
  "timers/promises",
  "url",
  "util",
  "util/types",
  "zlib",
]);

const sdkUrl = new URL("../sdk.ts", import.meta.url).href;

const networkGlobals: readonly string[] = ["fetch", "WebSocket", "EventSource"];

const processInternals: readonly string[] = ["binding", "_linkedBinding", "dlopen", "_debugProcess"];

const pipeMethods: readonly string[] = ["bind", "listen", "connect", "open"];

const removingFunctions: readonly string[] = [
  "unlink",
  "unlinkSync",
  "rm",
  "rmSync",
  "rmdir",
  "rmdirSync",
  "rename",
  "renameSync",
];

const removingPromiseFunctions: readonly string[] = ["unlink", "rm", "rmdir", "rename"];

function isAvailable(specifier: string): boolean {
  return availableBuiltins.has(specifier.replace(/^node:/, ""));
}

function unavailableModule(specifier: string): Error {
  return new Error(
    `The module ${specifier} is not available to scripts: reach files, the database and the network ` +
      "through the context the script is given.",
  );
}

function unavailable(name: string, instead: string): () => never {
  return () => {
    throw new Error(`${name} is not available to scripts: ${instead}`);
  };
}

function fixed(target: object, name: string, value: unknown): void {
  Object.defineProperty(target, name, { value, writable: false, configurable: false, enumerable: false });
}

registerHooks({
  resolve: (specifier, context, nextResolve) => {
    if (specifier === sdkSpecifier) {
      return { url: sdkUrl, format: "module-typescript", shortCircuit: true };
    }
    if (isBuiltin(specifier) && !isAvailable(specifier)) {
      throw unavailableModule(specifier);
    }
    const resolved = nextResolve(specifier, context);
    if (resolved.url.startsWith("node:") && !isAvailable(resolved.url)) {
      throw unavailableModule(resolved.url);
    }
    return resolved;
  },
});

for (const name of networkGlobals) {
  const get = unavailable(name, "reach the network through context.http.");
  Object.defineProperty(globalThis, name, { get, configurable: false, enumerable: false });
}

const getBuiltinModule = process.getBuiltinModule.bind(process);

fixed(process, "getBuiltinModule", (specifier: string) => {
  if (!isAvailable(specifier)) {
    throw unavailableModule(specifier);
  }
  return getBuiltinModule(specifier);
});

for (const name of processInternals) {
  fixed(process, name, unavailable(`process.${name}`, "it reaches into Node's internals."));
}

const kill = process.kill.bind(process);

fixed(process, "kill", (target: number, signal?: string | number) => {
  if (target !== process.pid) {
    throw new Error("process.kill is not available to scripts for other processes.");
  }
  return kill(target, signal);
});

fixed(Socket.prototype, "connect", unavailable("Socket.connect", "reach the network through context.http."));

function handlePrototype(stream: object): object | undefined {
  const handle: unknown = Reflect.get(stream, "_handle");
  const prototype: unknown = typeof handle === "object" && handle !== null ? Object.getPrototypeOf(handle) : undefined;
  return typeof prototype === "object" && prototype !== null ? prototype : undefined;
}

const handlePrototypes = new Set(
  [process.stdin, process.stdout, process.stderr].map(handlePrototype).filter((prototype) => prototype !== undefined),
);

for (const prototype of handlePrototypes) {
  for (const name of pipeMethods) {
    fixed(prototype, name, unavailable(`The ${name} method of a standard stream's handle`, "it opens sockets."));
  }
}

function withoutRemoval(target: object, names: readonly string[], prefix: string): void {
  for (const name of names) {
    const value = unavailable(`${prefix}${name}`, "removing or renaming a file needs the delete effect.");
    Object.defineProperty(target, name, { value, writable: false, configurable: false, enumerable: true });
  }
}

if (!process.argv.includes(removalAllowedArgument)) {
  const fileSystem = process.getBuiltinModule("node:fs");
  withoutRemoval(fileSystem, removingFunctions, "fs.");
  withoutRemoval(fileSystem.promises, removingPromiseFunctions, "fs.promises.");
  syncBuiltinESMExports();
}
