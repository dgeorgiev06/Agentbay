import { defineScript } from "../../../../bay/sdk.ts";
import { agreedScripts, checks } from "./lib/checks.ts";
import { hasScript, notSetUpReason, projectScripts } from "./lib/package-scripts.ts";

export const run = defineScript(async (_input, context) => {
  const found = await projectScripts(context);
  const missing = agreedScripts.filter((script) => script.need.kind === "required" && !hasScript(found, script));
  return {
    language: "TypeScript",
    sourceFiles: ["**/*.ts"],
    testFiles: ["**/*.test.ts"],
    practices: "practices.md",
    checks: checks.filter((check) => check.need.kind === "required" || hasScript(found, check)).map(({ name }) => name),
    present: agreedScripts.filter((script) => hasScript(found, script)).map(({ name }) => name),
    missing: missing.map((script) => ({ name: script.name, reason: notSetUpReason("project", script, found) })),
  };
});
