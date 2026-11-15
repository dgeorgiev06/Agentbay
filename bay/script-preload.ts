import { isBuiltin, registerHooks } from "node:module";
import { Socket } from "node:net";

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

const networkGlobals: readonly string[] = ["fetch", "WebSocket", "EventSource"];

const processInternals: readonly string[] = ["binding", "_linkedBinding", "dlopen", "_debugProcess"];

const pipeMethods: readonly string[] = ["bind", "listen", "connect", "open"];

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
