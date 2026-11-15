import { fileURLToPath } from "node:url";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

const kernelImportsForModes = {
  regex: "(^|/)bay/(?!sdk\\.ts$)",
  message: "Mode code may import from bay/ only bay/sdk.ts.",
};

const kernelImportsForAdapters = {
  regex: "(^|/)bay/(?!(sdk|adapter)\\.ts$)",
  message: "Adapters may import from bay/ only bay/sdk.ts and bay/adapter.ts.",
};

const entryPointImportsForKernel = [
  { regex: "(^|/)(cli|mcp)\\.ts$", message: "The kernel core never imports cli.ts or mcp.ts." },
  { regex: "(^|/)adapters/", message: "The kernel core never imports an adapter." },
];

const bannedSyntax = [
  { selector: "TSEnumDeclaration", message: "No enum: use a union of string literals." },
  { selector: "ClassDeclaration[superClass]", message: "No class inheritance." },
  { selector: "ClassExpression[superClass]", message: "No class inheritance." },
  { selector: "ExportDefaultDeclaration", message: "Named exports only." },
  { selector: "ExportSpecifier[exported.name='default']", message: "Named exports only." },
];

const dynamicImportSyntax = {
  selector: "ImportExpression",
  message: "Mode and adapter code uses static imports only.",
};

export default defineConfig(
  globalIgnores(["node_modules/"]),
  {
    linterOptions: { noInlineConfig: true, reportUnusedDisableDirectives: "error" },
  },
  {
    files: ["**/*.ts"],
    extends: [tseslint.configs.strictTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: repositoryRoot },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/consistent-type-assertions": ["error", { assertionStyle: "never" }],
      "@typescript-eslint/switch-exhaustiveness-check": ["error", { considerDefaultExhaustiveForUnions: false }],
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            { from: "package", package: "node:test", name: ["test", "describe", "it", "suite"] },
          ],
        },
      ],
      "@typescript-eslint/ban-ts-comment": [
        "error",
        { "ts-ignore": true, "ts-expect-error": true, "ts-nocheck": true, "ts-check": false },
      ],
      "max-params": "off",
      "@typescript-eslint/max-params": ["error", { max: 3 }],
      complexity: ["error", 10],
      "no-nested-ternary": "error",
      "no-param-reassign": "error",
      "no-restricted-syntax": ["error", ...bannedSyntax],
    },
  },
  {
    files: ["components/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [kernelImportsForModes] }],
      "no-restricted-syntax": ["error", ...bannedSyntax, dynamicImportSyntax],
    },
  },
  {
    files: ["adapters/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [kernelImportsForAdapters] }],
      "no-restricted-syntax": ["error", ...bannedSyntax, dynamicImportSyntax],
    },
  },
  {
    files: ["bay/**/*.ts"],
    ignores: ["bay/cli.ts", "bay/mcp.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: entryPointImportsForKernel }],
    },
  },
);
