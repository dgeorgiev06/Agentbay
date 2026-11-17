import assert from "node:assert/strict";
import { test } from "node:test";
import { type Binds, importSpecifiers, type ImportSpecifier } from "../bay/import-scanner.ts";

type Case = {
  readonly name: string;
  readonly source: string;
  readonly found: readonly ImportSpecifier[];
};

const literal = (text: string, binds: Binds, line = 1): ImportSpecifier => ({ kind: "literal", text, line, binds });

const computed = (line = 1): ImportSpecifier => ({ kind: "computed", line });

const evaluatorDodges: readonly Case[] = [
  {
    name: "a comment between import and (",
    source: 'await import/**/("../../other/x.ts");',
    found: [literal("../../other/x.ts", "values")],
  },
  { name: "no space around from", source: 'import {a}from"../x.ts";', found: [literal("../x.ts", "values")] },
  {
    name: "a comment inside the clause",
    source: 'import /* c */ { a } from "../x.ts";',
    found: [literal("../x.ts", "values")],
  },
  {
    name: "a string name in the braces",
    source: 'import { "string name" as a } from "../x.ts";',
    found: [literal("../x.ts", "values")],
  },
];

const forms: readonly Case[] = [
  { name: "a default import", source: 'import a from "./a.ts";', found: [literal("./a.ts", "values")] },
  { name: "a namespace import", source: "import * as all from './a.ts'", found: [literal("./a.ts", "values")] },
  { name: "a default and named import", source: 'import a, { b } from "./a.ts"', found: [literal("./a.ts", "values")] },
  { name: "import type", source: 'import type { A } from "./types.ts";', found: [literal("./types.ts", "types")] },
  { name: "a side-effect import", source: 'import "./setup.ts";', found: [literal("./setup.ts", "nothing")] },
  { name: "export * from", source: 'export * from "../x.ts";', found: [literal("../x.ts", "nothing")] },
  { name: "export * as from", source: 'export * as x from "../x.ts";', found: [literal("../x.ts", "nothing")] },
  {
    name: "export braces from",
    source: 'export { a, b as c } from "../x.ts";',
    found: [literal("../x.ts", "nothing")],
  },
  { name: "export type from", source: 'export type { A } from "../x.ts";', found: [literal("../x.ts", "nothing")] },
  { name: "a local export is not an import", source: "export { a };\nexport const b = 1;", found: [] },
  { name: "a dynamic import", source: 'const m = await import("./m.ts");', found: [literal("./m.ts", "values")] },
  {
    name: "a dynamic import with options",
    source: 'await import("./d.json", { with: {} });',
    found: [literal("./d.json", "values")],
  },
  {
    name: "a dynamic import of a plain template",
    source: "await import(`./m.ts`);",
    found: [literal("./m.ts", "values")],
  },
  { name: "a computed dynamic import", source: "await import(`./${name}.ts`);", found: [computed()] },
  { name: "a dynamic import of a variable", source: "await import(name);", found: [computed()] },
  { name: "a require", source: 'const fs = require("fs");', found: [literal("fs", "values")] },
  { name: "a computed require", source: "const fs = require(name);", found: [computed()] },
  { name: "import.meta is not an import", source: "const here = import.meta.url;", found: [] },
  { name: "a member named import is not an import", source: 'loader.import("./x.ts");', found: [] },
  { name: "a member named require is not one", source: 'loader.require("x");', found: [] },
];

const hidden: readonly Case[] = [
  { name: "an import inside a string", source: "const text = \"import { a } from 'yaml'\";", found: [] },
  { name: "an import inside a line comment", source: '// import { a } from "yaml";\nconst b = 1;', found: [] },
  { name: "an import inside a block comment", source: '/* import "yaml"; */ const b = 1;', found: [] },
  { name: "an import inside a template", source: 'const text = `import { a } from "yaml"`;', found: [] },
  { name: "a require inside a regular expression", source: 'const pattern = /require("yaml")/g;', found: [] },
  {
    name: "a quote inside a regular expression",
    source: 'const q = /"/;\nimport "./after.ts";',
    found: [literal("./after.ts", "nothing", 2)],
  },
  {
    name: "a division is not a regular expression",
    source: 'const half = a / 2; import "./x.ts"; // /',
    found: [literal("./x.ts", "nothing")],
  },
  {
    name: "an import inside a template's expression is seen",
    source: 'const text = `${await import("./inner.ts")}`;',
    found: [literal("./inner.ts", "values")],
  },
];

const layouts: readonly Case[] = [
  {
    name: "a specifier split across lines",
    source: 'import {\n  a,\n  b,\n}\nfrom\n  "../x.ts";',
    found: [literal("../x.ts", "values", 1)],
  },
  {
    name: "CRLF line ends",
    source: 'const a = 1;\r\nimport { b } from "./b.ts";\r\n',
    found: [literal("./b.ts", "values", 2)],
  },
  {
    name: "a file that ends inside a string",
    source: 'import "./ok.ts";\nconst s = "unterminated',
    found: [literal("./ok.ts", "nothing")],
  },
  {
    name: "a file that ends inside a comment",
    source: 'import "./ok.ts";\n/* never closed',
    found: [literal("./ok.ts", "nothing")],
  },
  { name: "a file that ends inside a template", source: "const t = `never ${closed", found: [] },
  { name: "a file that ends after import(", source: "await import(", found: [computed()] },
  { name: "a file that ends after from", source: "import { a } from", found: [] },
  {
    name: "an escaped quote does not end a string",
    source: 'const s = "a\\"b"; import "./x.ts";',
    found: [literal("./x.ts", "nothing")],
  },
  { name: "an escaped quote in a string", source: 'const s = "a \\" import \\"yaml\\"";', found: [] },
];

const bindings: readonly Case[] = [
  { name: "import type of a default", source: 'import type A from "./a.ts";', found: [literal("./a.ts", "types")] },
  {
    name: "import type of a namespace",
    source: 'import type * as A from "./a.ts";',
    found: [literal("./a.ts", "types")],
  },
  {
    name: "names that are all marked type",
    source: 'import { type A, type B as C } from "./a.ts";',
    found: [literal("./a.ts", "types")],
  },
  {
    name: "one name not marked type among names marked type",
    source: 'import { type A, run, type B } from "./a.ts";',
    found: [literal("./a.ts", "values")],
  },
  {
    name: "a default beside names marked type",
    source: 'import run, { type A } from "./a.ts";',
    found: [literal("./a.ts", "values")],
  },
  { name: "a default named type", source: 'import type from "./a.ts";', found: [literal("./a.ts", "values")] },
  {
    name: "a default named type beside names",
    source: 'import type, { a } from "./a.ts";',
    found: [literal("./a.ts", "values")],
  },
  { name: "a value named type", source: 'import { type } from "./a.ts";', found: [literal("./a.ts", "values")] },
  {
    name: "a value named type, renamed",
    source: 'import { type as kind } from "./a.ts";',
    found: [literal("./a.ts", "values")],
  },
  { name: "empty braces", source: 'import {} from "./a.ts";', found: [literal("./a.ts", "nothing")] },
  {
    name: "a trailing comma after a name marked type",
    source: 'import {\n  type A,\n} from "./a.ts";',
    found: [literal("./a.ts", "types")],
  },
];

for (const group of [evaluatorDodges, forms, hidden, layouts, bindings]) {
  for (const entry of group) {
    test(`the import scan: ${entry.name}`, () => {
      assert.deepEqual(importSpecifiers(entry.source), entry.found);
    });
  }
}
