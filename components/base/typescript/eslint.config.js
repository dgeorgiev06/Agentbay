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

const clockMessage = "A mode script reads the time with context.now(), which a step run again gets back unchanged.";

const randomMessage =
  "A mode script draws random values with context.random(bytes), which a step run again gets back unchanged.";

const randomCalls = "/^(randomBytes|randomUUID|randomInt|randomFill|randomFillSync|getRandomValues)$/";

const replaySafeSyntax = [
  { selector: "CallExpression[callee.property.name='now'][callee.object.name='Date']", message: clockMessage },
  { selector: "CallExpression[callee.property.value='now'][callee.object.name='Date']", message: clockMessage },
  { selector: "CallExpression[callee.property.name='now'][callee.object.property.name='Date']", message: clockMessage },
  { selector: "NewExpression[callee.name='Date'][arguments.length=0]", message: clockMessage },
  { selector: "NewExpression[callee.property.name='Date'][arguments.length=0]", message: clockMessage },
  { selector: "CallExpression[callee.name='Date']", message: clockMessage },
  { selector: "CallExpression[callee.property.name='Date']", message: clockMessage },
  { selector: "VariableDeclarator[init.name='Date']", message: clockMessage },
  { selector: "VariableDeclarator[init.property.name='Date']", message: clockMessage },
  { selector: "CallExpression[callee.property.name='random'][callee.object.name='Math']", message: randomMessage },
  { selector: "CallExpression[callee.property.value='random'][callee.object.name='Math']", message: randomMessage },
  {
    selector: "CallExpression[callee.property.name='random'][callee.object.property.name='Math']",
    message: randomMessage,
  },
  { selector: "VariableDeclarator[init.name='Math']", message: randomMessage },
  { selector: "VariableDeclarator[init.property.name='Math']", message: randomMessage },
  { selector: "VariableDeclarator[id.type='ObjectPattern'][init.name='crypto']", message: randomMessage },
  { selector: "VariableDeclarator[id.type='ObjectPattern'][init.property.name='crypto']", message: randomMessage },
  { selector: `CallExpression[callee.name=${randomCalls}]`, message: randomMessage },
  { selector: `CallExpression[callee.property.name=${randomCalls}]`, message: randomMessage },
  { selector: `CallExpression[callee.property.value=${randomCalls}]`, message: randomMessage },
  {
    selector: `ImportDeclaration[source.value=/^(node:)?crypto$/] ImportSpecifier[imported.name=${randomCalls}]`,
    message: randomMessage,
  },
];

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

const livingDocuments = /(^|\/)docs\/(requirements|designs|plans)(\/|$)/;

const pathCalls = new Set(["join", "resolve", "URL"]);

const livingDocumentReadByTheOneTest = {
  file: "components/base/requirements/tests/check.test.ts",
  reads: "docs/requirements/todo.yaml",
};

function calleeName(node) {
  if (node.callee.type === "Identifier") {
    return node.callee.name;
  }
  return node.callee.type === "MemberExpression" && node.callee.property.type === "Identifier"
    ? node.callee.property.name
    : undefined;
}

function isImportMeta(node) {
  return node.type === "MemberExpression" && node.object.type === "MetaProperty";
}

function pieceOf(node, constants, seen) {
  if (node.type === "Literal") {
    return { text: typeof node.value === "string" ? node.value : "", anchored: false };
  }
  if (isImportMeta(node)) {
    return { text: "", anchored: true };
  }
  if (node.type === "TemplateLiteral") {
    return joinedPieces([...node.quasis, ...node.expressions], constants, seen, "");
  }
  if (node.type === "TemplateElement") {
    return { text: node.value.cooked ?? "", anchored: false };
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return joinedPieces([node.left, node.right], constants, seen, "");
  }
  if (node.type === "Identifier" && constants.has(node.name) && !seen.has(node.name)) {
    return pieceOf(constants.get(node.name), constants, new Set([...seen, node.name]));
  }
  if ((node.type === "CallExpression" || node.type === "NewExpression") && pathCalls.has(calleeName(node))) {
    return joinedPieces(node.arguments, constants, seen, "/");
  }
  return { text: "", anchored: false };
}

function joinedPieces(nodes, constants, seen, between) {
  const ordered = [...nodes].sort((first, second) => first.range[0] - second.range[0]);
  const pieces = ordered.map((node) => pieceOf(node, constants, seen));
  return {
    text: pieces.map((piece) => piece.text).join(between),
    anchored: pieces.some((piece) => piece.anchored),
  };
}

function livingDocumentNamed(text) {
  const normalized = text.replace(/\/+/g, "/").replace(/(^|\/)(\.\.?\/)+/g, "$1");
  const at = normalized.search(livingDocuments);
  return at === -1 ? undefined : normalized.slice(at).replace(/^\/|\/$/g, "");
}

function isTheException(context, document, allowed) {
  const file = context.filename.slice(repositoryRoot.length).replace(/^\/+/, "");
  return allowed.some((entry) => entry.file === file && document === entry.reads);
}

const noLivingDocuments = {
  meta: {
    type: "problem",
    schema: [
      {
        type: "object",
        properties: {
          allowed: {
            type: "array",
            items: {
              type: "object",
              properties: { file: { type: "string" }, reads: { type: "string" } },
              required: ["file", "reads"],
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      living:
        "A test reads {{document}}, a living document of the owner's that changes as he signs new versions: " +
        "copy what the test needs into the test's fixtures and read it from there.",
    },
  },
  create(context) {
    const allowed = context.options[0]?.allowed ?? [];
    const constants = new Map();
    const calls = [];
    return {
      VariableDeclarator(node) {
        if (node.parent.kind === "const" && node.id.type === "Identifier" && node.init !== null) {
          constants.set(node.id.name, node.init);
        }
      },
      "CallExpression, NewExpression"(node) {
        if (pathCalls.has(calleeName(node))) {
          calls.push(node);
        }
      },
      "Program:exit"() {
        for (const node of calls) {
          const { text, anchored } = pieceOf(node, constants, new Set());
          const document = anchored ? livingDocumentNamed(text) : undefined;
          if (document !== undefined && !isTheException(context, document, allowed)) {
            context.report({ node, messageId: "living", data: { document } });
          }
        }
      },
    };
  },
};

const agentbayPlugin = { rules: { "no-comments": noComments, "no-living-documents": noLivingDocuments } };

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
      "no-empty": ["error", { allowEmptyCatch: false }],
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
    files: ["**/*.test.ts", "**/tests/**/*.ts"],
    plugins: { agentbay: agentbayPlugin },
    rules: { "agentbay/no-living-documents": ["error", { allowed: [livingDocumentReadByTheOneTest] }] },
  },
  {
    files: ["components/**/*.ts"],
    rules: {
      "no-restricted-imports": ["error", { patterns: [kernelImportsForModes, kitSpecifiersForModes] }],
      "no-restricted-syntax": ["error", ...bannedSyntax, dynamicImportSyntax],
    },
  },
  {
    files: ["components/**/*.ts"],
    ignores: ["components/**/tests/**", "components/**/*.test.ts"],
    rules: {
      "no-restricted-syntax": ["error", ...bannedSyntax, dynamicImportSyntax, ...replaySafeSyntax],
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
