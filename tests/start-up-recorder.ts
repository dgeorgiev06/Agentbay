import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";

const recordFile = process.env.AGENTBAY_START_UP_RECORD ?? "";
const compiledKey = Symbol.for("agentbay.start-up.compiled");
const loaded: string[] = [];
const compiled: string[] = [];

function schemaName(schema: unknown): string {
  const named = typeof schema === "object" && schema !== null && "title" in schema ? schema.title : undefined;
  return typeof named === "string" ? named : "a project schema";
}

Reflect.set(globalThis, compiledKey, (schema: unknown) => {
  compiled.push(schemaName(schema));
});

const ajvCompile = "_compileSchemaEnv(sch) {";

const countedCompile = `${ajvCompile} globalThis[Symbol.for("agentbay.start-up.compiled")](sch.schema);`;

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    loaded.push(url);
    if (!url.endsWith("/node_modules/ajv/dist/core.js")) {
      return result;
    }
    const source = typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);
    if (!source.includes(ajvCompile)) {
      throw new Error(`ajv/dist/core.js no longer holds ${ajvCompile}, so its compiles cannot be counted`);
    }
    return { ...result, source: source.replace(ajvCompile, countedCompile) };
  },
});

process.on("exit", () => {
  writeFileSync(recordFile, JSON.stringify({ loaded, compiled }));
});
