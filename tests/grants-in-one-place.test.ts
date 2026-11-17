import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path/posix";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const kit = join(fileURLToPath(new URL(".", import.meta.url)), "..");

const contractsFile = join(kit, "bay", "contracts.ts");

const scannedFolders = ["bay", "adapters"] as const;

const skippedFolders: readonly string[] = ["generated", "tests", "node_modules"];

function sourceFilesUnder(folder: string): readonly string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) {
      return skippedFolders.includes(entry.name) ? [] : sourceFilesUnder(path);
    }
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

function compilerOptions(): ts.CompilerOptions {
  const read = ts.readConfigFile(join(kit, "tsconfig.json"), (path) => ts.sys.readFile(path));
  return ts.parseJsonConfigFileContent(read.config, ts.sys, kit).options;
}

function grantsType(checker: ts.TypeChecker, program: ts.Program): ts.Type {
  const contracts = program.getSourceFile(contractsFile);
  const declaration = contracts?.statements.find(
    (statement) => ts.isTypeAliasDeclaration(statement) && statement.name.text === "ModeGrants",
  );
  assert.ok(declaration !== undefined && ts.isTypeAliasDeclaration(declaration), "bay/contracts.ts has ModeGrants");
  return checker.getTypeFromTypeNode(declaration.type);
}

function writesGrants(node: ts.Node, checker: ts.TypeChecker, grants: ts.Type): boolean {
  if (ts.isObjectLiteralExpression(node) && checker.isTypeAssignableTo(checker.getTypeAtLocation(node), grants)) {
    return true;
  }
  return ts.forEachChild(node, (child) => writesGrants(child, checker, grants) || undefined) ?? false;
}

function filesThatWriteGrants(): readonly string[] {
  const files = scannedFolders.flatMap((folder) => sourceFilesUnder(join(kit, folder)));
  const program = ts.createProgram(files, compilerOptions());
  const checker = program.getTypeChecker();
  const grants = grantsType(checker, program);
  return files
    .filter((path) => {
      const file = program.getSourceFile(path);
      return file !== undefined && writesGrants(file, checker, grants);
    })
    .map((path) => relative(kit, path))
    .sort();
}

test("only bay/policy.ts writes a mode's grants as an object, in the kernel and the adapters", () => {
  assert.deepEqual(filesThatWriteGrants(), ["bay/policy.ts"]);
});
