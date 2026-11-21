import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fieldsOf } from "../../../../bay/sdk.ts";
import { kitTemplate, listOf, printedCard, project, removeAll, shown, textAt, waitingOf } from "./kit-copy.ts";
import { givenIn, partStarted } from "./part-run.ts";

const alphabet = Array.from({ length: 26 }, (_, at) => String.fromCharCode(65 + at)).join("");

const nineteen = `got ${alphabet.slice(0, 19)}!`;

const agreed = "components/base/interfaces/proof.yaml";

let template: string;

before(async () => {
  template = await kitTemplate();
});

after(async () => {
  await removeAll();
});

test("given three rounds and reviews of a slice still failing, whose builder changed an interface file, and the final proof: the card withholds merge, and the reviewer's verdicts are judged lines that name no skill", async () => {
  const root = await project(template);
  const given = await givenIn("given-b1-card.json");
  const runId = await partStarted(root, "forge:workflows/rounds.yaml", { trigger: {}, part: { given } });
  const run = await shown(root, runId);
  assert.deepEqual(fieldsOf(fieldsOf(run).target ?? null).part, {
    given: Object.keys(fieldsOf(given)),
  });
  const card = waitingOf(run, "card");
  assert.deepEqual(listOf(card.choices)[0], {
    name: "merge",
    status: "withheld",
    does: "Merge into the integration branch",
    reason: `1 must item failed; the interface file ${agreed} changed during the rounds.`,
  });
  assert.deepEqual(await printedCard(root, runId), [
    "Merge B1 into integration?",
    "  Merge is not offered: 1 must item failed;",
    "    the interface file",
    "    components/base/interfaces/proof.yaml",
    "    changed during the rounds.",
    "  DOD-B1-1, must, failed: A quill that was",
    "    added is counted.",
    "  why: the named tests fail on the head",
    "  proof's reason: The named tests fail on",
    "    the head.",
    "  failing: b1 quill that was added is",
    "    counted",
    `  its message: ${nineteen}`,
    "  failing: b1 quill that was added is",
    "    counted twice",
    "  DOD-B1-2, must, passed: The checks pass.",
    "  the design's examples: none, since the",
    "    slice's request carries none of a",
    "    design's examples; nothing is withheld",
    "    for them",
    "  practices answered by the reviewer in",
    "    round 3: 65; 65 held, 0 not held, 0 do",
    "    not apply; a check holds 12 more",
    "  1 file changed; the work and the tests are",
    "    on forge/B1-tests-3, the builder's work",
    "    alone on forge/B1-3",
    "  size in lines: components/ +1",
    "  interface file changed during the rounds:",
    "    components/base/interfaces/proof.yaml",
    "  rounds: 3 of at most 3; no more may run",
    "  the reviewer, in round 3, before the final",
    "    proof:",
    "judged   DOD-B1-1 not held: The count is off",
    "judged     by one for every quill.",
    "judged   DOD-B1-2 held by 1 case",
    "judged   2 findings remain: 1 for the",
    "judged     builder, 1 for the test writer",
    "judged   for the builder, condition: Count",
    "judged     each quill once.",
    "judged   for the test writer, Q3, b1 quill",
    "judged     that was added is counted: kept",
    "judged     from the card: it quotes a test",
    "Unmarked lines were worked out by script.",
    "You can:",
    "  keep  Stop; the branches stay",
    "Not available:",
    "  merge      Merge into the integration",
    "             branch",
    "             why: 1 must item failed; the",
    "             interface file",
    "             components/base/interfaces/proo",
    "             f.yaml changed during the",
    "             rounds.",
    "  send-back  A round after the card",
    "             why: No round runs after the",
    "             card.",
    "  discard    Stop; the worktrees go",
    "             why: Discarding comes with",
    "             slice WD1.",
    "checked: 0 ran, 15 computed, 5 judged",
  ]);
});

test("given one round whose final proof failed a must item: merge is withheld, and the card gives the item's reason", async () => {
  const root = await project(template);
  const given = await givenIn("given-r7-failed.json");
  const runId = await partStarted(root, "forge:workflows/rounds.yaml", { trigger: {}, part: { given } });
  const card = waitingOf(await shown(root, runId), "card");
  const words = listOf(fieldsOf(card.card).lines).map((line) => textAt(line, "words"));
  const failedAt = words.indexOf("DOD-R7-1, must, failed: A quill that was added is counted.");
  assert.ok(failedAt > 0, words.join("\n"));
  assert.equal(words[failedAt + 1], "why: the named tests fail on the head");
  assert.deepEqual(listOf(card.choices)[0], {
    name: "merge",
    status: "withheld",
    does: "Merge into the integration branch",
    reason: "1 must item failed.",
  });
});
