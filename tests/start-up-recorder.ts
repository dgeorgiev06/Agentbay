import { writeFileSync } from "node:fs";
import { registerHooks } from "node:module";

type Counted = "compiled" | "checked";

const recordFile = process.env.AGENTBAY_START_UP_RECORD ?? "";
const loaded: string[] = [];
const counted: Record<Counted, string[]> = { compiled: [], checked: [] };

function schemaName(schema: unknown): string {
  const named = typeof schema === "object" && schema !== null && "title" in schema ? schema.title : undefined;
  return typeof named === "string" ? named : "a project schema";
}

Reflect.set(globalThis, Symbol.for("agentbay.start-up.counted"), (what: Counted, schema: unknown) => {
  counted[what].push(schemaName(schema));
});

const ajvLines: readonly (readonly [string, string])[] = [
  ["_compileSchemaEnv(sch) {", '"compiled", sch.schema'],
  ["validateSchema(schema, throwOrLogError) {", '"checked", schema'],
];

function counting(source: string): string {
  return ajvLines.reduce((text, [line, call]) => {
    if (!text.includes(line)) {
      throw new Error(`ajv/dist/core.js no longer holds ${line}, so it cannot be counted`);
    }
    return text.replace(line, `${line} globalThis[Symbol.for("agentbay.start-up.counted")](${call});`);
  }, source);
}

registerHooks({
  load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    loaded.push(url);
    if (!url.endsWith("/node_modules/ajv/dist/core.js")) {
      return result;
    }
    const source = typeof result.source === "string" ? result.source : new TextDecoder().decode(result.source);
    return { ...result, source: counting(source) };
  },
});

process.on("exit", () => {
  writeFileSync(recordFile, JSON.stringify({ loaded, ...counted }));
});
