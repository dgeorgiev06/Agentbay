import assert from "node:assert/strict";
import { test } from "node:test";
import { loadSystem } from "../bay/manifests/manifests.ts";
import type { Problem } from "../bay/outcome.ts";
import { fakeFileSystem } from "./fakes.ts";
import { layout, paths, rooted, validFiles } from "./system-fixture.ts";

async function problemsWith(changes: Readonly<Record<string, string>>): Promise<readonly Problem[]> {
  const outcome = await loadSystem(fakeFileSystem(rooted({ ...validFiles(), ...changes })), layout);
  assert.ok(!outcome.ok, "expected the system to be refused");
  return outcome.problems;
}

test("a manifest is read by the toolbox's reader: a tag that is not YAML's own is refused with its line", async () => {
  assert.deepEqual(await problemsWith({ [paths.config]: "adapter: !shell local\nbindings: {}\n" }), [
    {
      file: paths.config,
      path: "",
      line: 1,
      message: "The YAML has the tag !shell, which is not one of YAML's own: str, int, float, bool, null, map and seq.",
      fix: "Remove the tag and write the value as plain YAML.",
    },
  ]);
});

test("a manifest is read by the toolbox's reader: aliases that copy more than 100 nodes are refused", async () => {
  const chain = [
    'a: &a ["x", "x", "x", "x", "x", "x", "x", "x", "x", "x"]',
    "b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a, *a]",
    "c: [*b, *b, *b, *b, *b, *b, *b, *b, *b, *b]",
    "adapter: local",
    "bindings: {}",
    "",
  ].join("\n");
  assert.deepEqual(await problemsWith({ [paths.config]: chain }), [
    {
      file: paths.config,
      path: "",
      line: 2,
      message: "The YAML's aliases would copy more than 100 nodes.",
      fix: "Write the repeated part out, or use fewer aliases.",
    },
  ]);
});
