import assert from "node:assert/strict";
import { join } from "node:path/posix";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const kit = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const sdkFile = join(kit, "bay", "sdk.ts");

const kernelFolder = join(kit, "bay");

const printed = ts.TypeFormatFlags.NoTruncation;

function compilerOptions(): ts.CompilerOptions {
  const read = ts.readConfigFile(join(kit, "tsconfig.json"), (path) => ts.sys.readFile(path));
  return ts.parseJsonConfigFileContent(read.config, ts.sys, kit).options;
}

type Listing = {
  readonly checker: ts.TypeChecker;
  readonly lines: string[];
  readonly reached: Map<string, ts.Symbol>;
  readonly exported: ReadonlySet<string>;
  readonly walked: Set<ts.Type>;
};

function isKernelAlias(symbol: ts.Symbol | undefined): symbol is ts.Symbol {
  const file = symbol?.declarations?.[0]?.getSourceFile().fileName;
  return file !== undefined && file.startsWith(kernelFolder) && symbol?.flags === ts.SymbolFlags.TypeAlias;
}

function isReference(type: ts.Type): type is ts.TypeReference {
  return (
    "objectFlags" in type && typeof type.objectFlags === "number" && (type.objectFlags & ts.ObjectFlags.Reference) !== 0
  );
}

function isDeclaredOutside(type: ts.Type): boolean {
  const file = type.getSymbol()?.declarations?.[0]?.getSourceFile().fileName;
  return file !== undefined && !file.startsWith(kernelFolder);
}

function typesInside(checker: ts.TypeChecker, type: ts.Type): readonly ts.Type[] {
  const argumentTypes = [
    ...(type.aliasTypeArguments ?? []),
    ...(isReference(type) ? checker.getTypeArguments(type) : []),
  ];
  if (isDeclaredOutside(type)) {
    return argumentTypes;
  }
  const signatures = [...type.getCallSignatures(), ...type.getConstructSignatures()];
  return [
    ...argumentTypes,
    ...(type.isUnionOrIntersection() ? type.types : []),
    ...checker.getPropertiesOfType(type).map((property) => checker.getTypeOfSymbol(property)),
    ...checker.getIndexInfosOfType(type).map((info) => info.type),
    ...signatures.flatMap((signature) => [
      checker.getReturnTypeOfSignature(signature),
      ...signature.getParameters().map((parameter) => checker.getTypeOfSymbol(parameter)),
    ]),
  ];
}

function walk(listing: Listing, type: ts.Type): void {
  if (listing.walked.has(type)) {
    return;
  }
  listing.walked.add(type);
  const alias = type.aliasSymbol;
  if (isKernelAlias(alias) && !listing.exported.has(alias.name)) {
    listing.reached.set(alias.name, alias);
  }
  for (const inside of typesInside(listing.checker, type)) {
    walk(listing, inside);
  }
}

function isExpanded(type: ts.Type, checker: ts.TypeChecker): boolean {
  const isObject = (type.flags & ts.TypeFlags.Object) !== 0 || type.isIntersection();
  const symbol = type.getSymbol();
  const plainObject = symbol === undefined || symbol.name === "__type" || type.isIntersection();
  return (
    isObject &&
    plainObject &&
    !type.isUnion() &&
    type.getCallSignatures().length === 0 &&
    checker.getPropertiesOfType(type).length > 0
  );
}

function modifiersOf(property: ts.Symbol): { readonly readonly: string; readonly optional: string } {
  const declaration = property.declarations?.[0];
  const isReadonly =
    declaration !== undefined && (ts.getCombinedModifierFlags(declaration) & ts.ModifierFlags.Readonly) !== 0;
  const isOptional = (property.flags & ts.SymbolFlags.Optional) !== 0;
  return { readonly: isReadonly ? "readonly " : "", optional: isOptional ? "?" : "" };
}

function declaredTypeOf(checker: ts.TypeChecker, property: ts.Symbol): ts.Type {
  const declaration = property.declarations?.[0];
  if (declaration !== undefined && ts.isPropertySignature(declaration) && declaration.type !== undefined) {
    return checker.getTypeFromTypeNode(declaration.type);
  }
  return checker.getTypeOfSymbol(property);
}

function listMembers(listing: Listing, path: string, type: ts.Type): void {
  const checker = listing.checker;
  const indent = "  ".repeat(path.split(".").length);
  for (const property of checker.getPropertiesOfType(type)) {
    const propertyType = declaredTypeOf(checker, property);
    const { readonly, optional } = modifiersOf(property);
    const member = `${indent}${readonly}${path}.${property.name}${optional}`;
    walk(listing, propertyType);
    if (propertyType.aliasSymbol === undefined && isExpanded(propertyType, checker)) {
      listing.lines.push(`${member}: {`);
      listMembers(listing, `${path}.${property.name}`, propertyType);
      listing.lines.push(`${indent}}`);
    } else {
      listing.lines.push(`${member}: ${checker.typeToString(propertyType, undefined, printed)}`);
    }
  }
}

function typeParametersOf(symbol: ts.Symbol): string {
  const declaration = symbol.declarations?.[0];
  if (
    declaration === undefined ||
    !ts.isTypeAliasDeclaration(declaration) ||
    declaration.typeParameters === undefined
  ) {
    return "";
  }
  return `<${declaration.typeParameters.map((parameter) => parameter.name.text).join(", ")}>`;
}

function listAlias(listing: Listing, symbol: ts.Symbol, label: string): void {
  const checker = listing.checker;
  const type = checker.getDeclaredTypeOfSymbol(symbol);
  const name = `${label} ${symbol.name}${typeParametersOf(symbol)}`;
  walk(listing, type);
  for (const inside of typesInside(checker, type)) {
    walk(listing, inside);
  }
  if (isExpanded(type, checker)) {
    listing.lines.push(`${name} = {`);
    listMembers(listing, symbol.name, type);
    listing.lines.push("}");
    return;
  }
  const written = checker.typeToString(type, undefined, printed | ts.TypeFormatFlags.InTypeAlias);
  listing.lines.push(`${name} = ${written}`);
}

function listFunction(listing: Listing, symbol: ts.Symbol): void {
  const checker = listing.checker;
  const type = checker.getTypeOfSymbol(symbol);
  walk(listing, type);
  for (const signature of type.getCallSignatures()) {
    listing.lines.push(`function ${symbol.name}${checker.signatureToString(signature, undefined, printed)}`);
  }
}

function toolboxSurface(): readonly string[] {
  const program = ts.createProgram([sdkFile], compilerOptions());
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(sdkFile);
  const module = source === undefined ? undefined : checker.getSymbolAtLocation(source);
  assert.ok(module !== undefined, "the compiler reads bay/sdk.ts as a module");
  const exports = checker
    .getExportsOfModule(module)
    .map((symbol) => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol))
    .sort((first, second) => (first.name < second.name ? -1 : 1));
  const listing: Listing = {
    checker,
    lines: [],
    reached: new Map(),
    exported: new Set(exports.map((symbol) => symbol.name)),
    walked: new Set(),
  };
  for (const symbol of exports) {
    if (symbol.flags & ts.SymbolFlags.Function) {
      listFunction(listing, symbol);
    } else {
      listAlias(listing, symbol, "type");
    }
  }
  const listed = new Set<string>();
  for (let next = [...listing.reached.values()]; next.length > 0; next = [...listing.reached.values()]) {
    for (const symbol of next.sort((first, second) => (first.name < second.name ? -1 : 1))) {
      listing.reached.delete(symbol.name);
      if (!listed.has(symbol.name)) {
        listed.add(symbol.name);
        listAlias(listing, symbol, "reached type");
      }
    }
  }
  return listing.lines;
}

const pinnedSurface: readonly string[] = [
  "type AgentQueryResult = {",
  "  readonly AgentQueryResult.columns: readonly string[]",
  "  readonly AgentQueryResult.rows: readonly (readonly Json[])[]",
  "}",
  'type CommandEnd = { readonly how: "exited"; readonly exitCode: number; } | { readonly how: "signalled"; readonly signal: string; } | { readonly how: "timed-out"; }',
  "type CommandOutput = {",
  "  readonly CommandOutput.text: string",
  "  readonly CommandOutput.cut: boolean",
  "}",
  "type CommandRan = {",
  "  readonly CommandRan.end: CommandEnd",
  "  readonly CommandRan.milliseconds: number",
  "  readonly CommandRan.stdout: CommandOutput",
  "  readonly CommandRan.stderr: CommandOutput",
  "}",
  "type CommandRequest = {",
  "  readonly CommandRequest.name: string",
  "  readonly CommandRequest.arguments: readonly string[]",
  "  readonly CommandRequest.folder: string",
  "  readonly CommandRequest.timeLimitSeconds: number",
  "  readonly CommandRequest.input?: string",
  "}",
  "type DatabasePartition = {",
  "  readonly DatabasePartition.execute: (sql: string, parameters?: SqlParameters | undefined) => Promise<Answer<ExecuteResult>>",
  "  readonly DatabasePartition.query: (sql: string, parameters?: SqlParameters | undefined) => Promise<Answer<readonly Readonly<Record<string, Json>>[]>>",
  "  readonly DatabasePartition.migrate: () => Promise<Answer<readonly string[]>>",
  "  readonly DatabasePartition.agentQuery: (sql: string) => Promise<Answer<AgentQueryResult>>",
  "}",
  "type DatabaseStatements = {",
  "  readonly DatabaseStatements.execute: (sql: string, parameters?: SqlParameters | undefined) => Promise<Answer<ExecuteResult>>",
  "  readonly DatabaseStatements.query: (sql: string, parameters?: SqlParameters | undefined) => Promise<Answer<readonly Readonly<Record<string, Json>>[]>>",
  "}",
  "type DefinedScript = {",
  '  readonly DefinedScript.kind: "agentbay-script"',
  "  readonly DefinedScript.handler: ScriptHandler",
  "}",
  "type ExecuteResult = {",
  "  readonly ExecuteResult.changes: number",
  "  readonly ExecuteResult.lastInsertRowid: number",
  "}",
  "type HttpRequest = {",
  '  readonly HttpRequest.method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"',
  "  readonly HttpRequest.url: string",
  "  readonly HttpRequest.headers: Readonly<Record<string, string>>",
  "  readonly HttpRequest.body?: string",
  "}",
  "type HttpResponse = {",
  "  readonly HttpResponse.status: number",
  "  readonly HttpResponse.headers: Readonly<Record<string, string>>",
  "  readonly HttpResponse.body: string",
  "}",
  "type Json = string | number | boolean | readonly Json[] | { readonly [key: string]: Json; } | null",
  "type JsonFields = { readonly [key: string]: Json; }",
  'type PathMatch = { readonly kind: "matched"; } | { readonly kind: "not matched"; } | { readonly kind: "not a pattern"; readonly reason: string; } | { readonly kind: "not a path"; readonly reason: string; }',
  "type Row = { readonly [x: string]: Json; }",
  "type ScriptContext = {",
  "  readonly ScriptContext.db: {",
  "    readonly ScriptContext.db.execute: (sql: string, parameters?: SqlParameters | undefined) => Promise<Answer<ExecuteResult>>",
  "    readonly ScriptContext.db.query: (sql: string, parameters?: SqlParameters | undefined) => Promise<Answer<readonly Readonly<Record<string, Json>>[]>>",
  "    readonly ScriptContext.db.partition: (name: string) => DatabasePartition",
  "  }",
  "  readonly ScriptContext.files: {",
  "    readonly ScriptContext.files.read: (path: string) => Promise<Answer<string>>",
  "    readonly ScriptContext.files.write: (path: string, text: string) => Promise<Answer<null>>",
  "    readonly ScriptContext.files.list: (path: string) => Promise<Answer<readonly string[]>>",
  "    readonly ScriptContext.files.makeFolder: (path: string) => Promise<Answer<null>>",
  "    readonly ScriptContext.files.link: (path: string, target: string) => Promise<Answer<null>>",
  "    readonly ScriptContext.files.remove: (path: string) => Promise<Answer<null>>",
  "  }",
  "  readonly ScriptContext.secrets: {",
  "    readonly ScriptContext.secrets.get: (name: string) => Promise<Answer<string>>",
  "  }",
  "  readonly ScriptContext.http: {",
  "    readonly ScriptContext.http.request: (request: HttpRequest) => Promise<Answer<HttpResponse>>",
  "  }",
  "  readonly ScriptContext.events: {",
  "    readonly ScriptContext.events.emit: (kind: string, detail: Json) => Promise<Answer<null>>",
  "  }",
  "  readonly ScriptContext.commands: {",
  "    readonly ScriptContext.commands.run: (request: CommandRequest) => Promise<Answer<CommandRan>>",
  "  }",
  "  readonly ScriptContext.call: (reference: string, input: Json) => Promise<Answer<Json>>",
  "  readonly ScriptContext.schemas: {",
  "    readonly ScriptContext.schemas.check: (schema: string, value: Json) => Promise<Answer<SchemaCheck>>",
  "  }",
  "  readonly ScriptContext.settings: Readonly<Record<string, Json>>",
  "  readonly ScriptContext.now: () => Date",
  "  readonly ScriptContext.spend: (spending: Spending) => Promise<Answer<null>>",
  "  readonly ScriptContext.caller: string | undefined",
  "  readonly ScriptContext.skillInput: Json | undefined",
  "}",
  "type ScriptError = {",
  '  readonly ScriptError.kind: "script-error"',
  "  readonly ScriptError.reason: string",
  "}",
  "type ScriptHandler = (input: Json, context: ScriptContext) => Promise<Json>",
  "type Spending = {",
  "  readonly Spending.items?: number",
  "  readonly Spending.usd?: number",
  "  readonly Spending.tokens?: number",
  "}",
  "type SqlParameters = readonly Json[] | Readonly<Record<string, Json>>",
  "type TimeWindow = {",
  "  readonly TimeWindow.start: Date",
  "  readonly TimeWindow.end: Date",
  "}",
  "function canonicalJson(value: Json): string",
  "function defineScript(handler: ScriptHandler): DefinedScript",
  "function fail(reason: string): never",
  "function fieldsOf(value: Json): JsonFields",
  "function isWithinWindow(time: Date, window: TimeWindow): boolean",
  "function parseIsoTime(text: string): Date | undefined",
  "function pathMatch(pattern: string, path: string): PathMatch",
  "function readYaml(text: string): YamlRead",
  "function segmentsOfPointer(pointer: string): readonly (string | number)[]",
  "function shortHash(value: Json): string",
  "reached type Answer<T> = { readonly ok: true; readonly value: T; } | Refusal | Failure",
  "reached type Failure = {",
  "  readonly Failure.ok: false",
  '  readonly Failure.kind: "failed"',
  "  readonly Failure.message: string",
  "}",
  "reached type Refusal = {",
  "  readonly Refusal.ok: false",
  '  readonly Refusal.kind: "refused"',
  "  readonly Refusal.resource: Resource",
  "  readonly Refusal.asked: string",
  "  readonly Refusal.declared: string",
  "  readonly Refusal.change: string",
  "  readonly Refusal.message: string",
  "}",
  'reached type Resource = "db" | "files" | "secrets" | "http" | "events" | "call" | "spend" | "script" | "commands" | "schemas"',
  "reached type SchemaCheck = { readonly passed: true; readonly value: Json; } | { readonly passed: false; readonly problems: readonly SchemaProblem[]; }",
  "reached type SchemaProblem = {",
  "  readonly SchemaProblem.path: string",
  "  readonly SchemaProblem.message: string",
  "  readonly SchemaProblem.fix?: string",
  "}",
  "reached type YamlPath = readonly (string | number)[]",
  "reached type YamlProblem = {",
  "  readonly YamlProblem.line: number",
  "  readonly YamlProblem.message: string",
  "  readonly YamlProblem.fix: string",
  "}",
  "reached type YamlRead = { readonly ok: true; readonly value: Json; readonly lineOf: (path: YamlPath) => number | undefined; } | { readonly ok: false; readonly problems: readonly YamlProblem[]; }",
];

test("the toolbox's surface is the pinned one, line for line", () => {
  assert.deepEqual(toolboxSurface(), pinnedSurface);
});
