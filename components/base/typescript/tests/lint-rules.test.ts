import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const kit = fileURLToPath(new URL("../../../..", import.meta.url));

const lint = new ESLint({ cwd: kit, overrideConfigFile: "components/base/typescript/eslint.config.js" });

const modeScript = "components/base/typescript/scripts/check.ts";

const kernelFile = "bay/sdk.ts";

async function ruleOf(path: string, rule: string): Promise<unknown> {
  const config: unknown = await lint.calculateConfigForFile(path);
  if (typeof config !== "object" || config === null || !("rules" in config)) {
    return undefined;
  }
  const { rules } = config;
  return typeof rules === "object" && rules !== null
    ? Object.entries(rules).find(([name]) => name === rule)?.[1]
    : undefined;
}

test("an empty block, an empty catch among them, is an error for every TypeScript file of the kit (TS-24)", async () => {
  assert.deepEqual(await ruleOf(modeScript, "no-empty"), [2, { allowEmptyCatch: false }]);
  assert.deepEqual(await ruleOf(kernelFile, "no-empty"), [2, { allowEmptyCatch: false }]);
});
