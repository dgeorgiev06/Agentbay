import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));

const kernelImportsForModes = {
  regex: "(^|/)bay/(?!sdk\\.ts$)",
  message: "Mode code may import from bay/ only bay/sdk.ts.",
};

const kitSpecifiersForModes = {
  regex: "^agentbay/(?!sdk$)",
  message: "Mode code names the kit only as agentbay/sdk.",
};

const modeTiers = ["base", "modes"];

const deepestModeFolderLevel = 6;

function modeFolders() {
  return modeTiers.flatMap((tier) => {
    const tierFolder = join(repositoryRoot, "components", tier);
    if (!existsSync(tierFolder)) {
      return [];
    }
    return readdirSync(tierFolder, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ tier, mode: entry.name }));
  });
}

function parentSteps(count) {
  return `(\\.\\./){${count}}`;
}

const interfaceSharedTest = "(?!.*/interfaces/[a-z0-9-]+/tests/shared\\.ts$)";

function otherModeImports(tier, mode, depth) {
  const intoTier = `${parentSteps(depth + 1)}(?!${mode}/|\\.\\./)`;
  const intoComponents = `${parentSteps(depth + 2)}(?!${tier}/${mode}/|\\.\\./)`;
  const intoRepository = `${parentSteps(depth + 3)}components/(?!${tier}/${mode}/)`;
  return {
    regex: `^${interfaceSharedTest}(${intoTier}|${intoComponents}|${intoRepository})`,
    message: "A mode may not import the files of another mode; call its actions through an interface.",
  };
}

const modeBoundaryConfigs = modeFolders().flatMap(({ tier, mode }) =>
  Array.from({ length: deepestModeFolderLevel + 1 }, (_, depth) => ({
    files: [`components/${tier}/${mode}/${"*/".repeat(depth)}*.ts`],
    rules: {
      "no-restricted-imports": [
        "error",
        { patterns: [kernelImportsForModes, kitSpecifiersForModes, otherModeImports(tier, mode, depth)] },
      ],
    },
  })),
);

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
  {
    selector: ":matches(PropertyDefinition, MethodDefinition)[accessibility]",
    message: "No private, protected or public keyword: a private member is written #name.",
  },
];

const dynamicImportSyntax = {
  selector: "ImportExpression",
  message: "Mode and adapter code uses static imports only.",
};

const noComments = {
  meta: {
    type: "problem",
    schema: [],
    messages: { comment: "No comments in kit code: put the reason in a name, an error message or the README." },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          context.report({ loc: comment.loc, messageId: "comment" });
        }
      },
    };
  },
};

const agentbayPlugin = { rules: { "no-comments": noComments } };

export default defineConfig(
  globalIgnores(["node_modules/", "tests/fixtures/", ".forge/"]),
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
      "@typescript-eslint/prefer-readonly": "error",
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
    files: ["bay/**/*.ts", "adapters/**/*.ts", "components/**/*.ts", "schemas/**/*.ts"],
    plugins: { agentbay: agentbayPlugin },
    rules: { "agentbay/no-comments": "error" },
  },
  {
    files: ["components/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [kernelImportsForModes, kitSpecifiersForModes] }],
      "no-restricted-syntax": ["error", ...bannedSyntax, dynamicImportSyntax],
    },
  },
  ...modeBoundaryConfigs,
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
