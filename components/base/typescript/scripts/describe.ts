import { defineScript } from "../../../../bay/sdk.ts";
import { checks } from "./lib/checks.ts";

export const run = defineScript(() =>
  Promise.resolve({
    language: "TypeScript",
    sourceFiles: ["**/*.ts"],
    testFiles: ["**/*.test.ts"],
    practices: "components/base/typescript/practices.md",
    checks: checks.map((check) => check.name),
  }),
);
