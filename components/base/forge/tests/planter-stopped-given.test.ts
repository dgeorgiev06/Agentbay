import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import {
  askedOf,
  decided,
  kitTemplate,
  printedCard,
  project,
  provedIn,
  removeAll,
  runOf,
  shown,
  textAt,
  waitingOf,
  type Proved,
} from "./kit-copy.ts";
import { givenIn, partStarted } from "./part-run.ts";

const name = "P2";

const caughtName = "the count is one too many";

const code = "components/modes/p2/scripts/quill.ts";

const owner: Json = {
  name: caughtName,
  patch: [
    `--- a/${code}`,
    `+++ b/${code}`,
    "@@ -1 +1 @@",
    "-Written by the builder in .forge/worktrees/P2.",
    "+Written by nobody.",
    "",
  ].join("\n"),
  tests: ["components/modes/p2/tests/quill.test.ts"],
};

const notKnown: Proved = {
  verdicts: [
    { item: "DOD-P2-1", kind: "fails-first", verdict: "passed", detail: "It held." },
    {
      item: "DOD-P2-2",
      kind: "bugs-caught",
      verdict: "inconclusive",
      reason: "No bugs were given to inject, so nothing is known.",
    },
    { item: "checks", kind: "checks", verdict: "passed", detail: "It held." },
  ],
  judgement: [],
  size: [{ path: code, head: 1 }],
};

let template: string;

before(async () => {
  template = await kitTemplate();
});

after(async () => {
  await removeAll();
});

test("given rounds whose builder stopped, the final proof is asked with the owner's bugs alone, named apart, and the card names no planter", async () => {
  const root = await project(template);
  await provedIn(root, name, notKnown);
  const given = await givenIn("given-p2-stopped.json");
  const runId = await partStarted(root, "forge:workflows/rounds.yaml", { trigger: {}, part: { given } });
  const proved = await askedOf(root, name);
  assert.equal(proved.length, 1);
  assert.deepEqual(fieldsOf(proved[0] ?? null).bugs, [owner, { ...fieldsOf(owner), name: `${caughtName} (2)` }]);
  const printed = await printedCard(root, runId);
  assert.equal(printed[0], "Merge P2 into integration?");
  assert.ok(!printed.some((line) => line.includes("planter")), printed.join("\n"));
  const card = waitingOf(await shown(root, runId), "card");
  const kept = runOf(await decided(root, card, { step: "card", choice: "keep" }));
  assert.equal(textAt(kept, "status"), "done");
});
