import assert from "node:assert/strict";
import { test } from "node:test";
import { codePaths } from "../scripts/lib/code.ts";

const testPath = "components/modes/c1/tests/quill.test.ts";

function changed(paths: readonly string[]): { readonly paths: readonly { path: string; how: string }[] } {
  return { paths: paths.map((path) => ({ path, how: "modified" })) };
}

test("the code handed on is the changed files less the deleted ones and the fixed test files", () => {
  const answer = {
    paths: [
      { path: "components/modes/c1/scripts/quill.ts", how: "added" },
      { path: testPath, how: "added" },
      { path: "components/modes/c1/scripts/old.ts", how: "deleted" },
    ],
  };
  assert.deepEqual(codePaths(answer, [testPath]), ["components/modes/c1/scripts/quill.ts"]);
  assert.deepEqual(codePaths(answer, []), ["components/modes/c1/scripts/quill.ts", testPath]);
});

test("at most 200 changed files are handed on, in the order git gave them", () => {
  const paths = Array.from({ length: 201 }, (_, at) => `components/modes/c1/scripts/file-${String(at)}.ts`);
  const handed = codePaths(changed(paths), []);
  assert.equal(handed.length, 200);
  assert.equal(handed.at(-1), "components/modes/c1/scripts/file-199.ts");
});
