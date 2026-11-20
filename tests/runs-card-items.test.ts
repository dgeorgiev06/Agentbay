import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import type { Action } from "../bay/generated/mode.ts";
import type { Config } from "../bay/generated/config.ts";
import type { Workflow } from "../bay/generated/workflow.ts";
import { numberField } from "../bay/json.ts";
import type { Run, Runs } from "../bay/runs/runs.ts";
import {
  answer,
  failure,
  finished,
  fixtureRefusal,
  fixtureSystem,
  notesFlow,
  openedRuns,
  runOf,
  secretValue,
  withFlow,
  type Changes,
  type OpenedRuns,
} from "./runs-fixture.ts";

const flow = { workflow: notesFlow };

const pass: Action = {
  description: "When a test passes its input on.",
  input: "schemas/anything.json",
  output: "schemas/anything.json",
  effects: ["read"],
  run: [{ script: "scripts/log.ts" }],
};

const gate: Action = {
  ...pass,
  description: "When a test lets an item through.",
  run: [{ script: "scripts/slow.ts" }],
};

type Waits = readonly Extract<Run["state"], { readonly status: "waiting" }>["waiting"][];

type Line = {
  readonly mark: string;
  readonly words: string;
  readonly source: Readonly<Record<string, Json>>;
};

type Opening = {
  readonly lines: readonly Line[];
  readonly quotes?: readonly string[];
  readonly gateFailsFirst?: number;
};

function cardSteps(quotes: readonly string[]): Workflow["steps"] {
  return [
    { id: "offer", action: "pass", input: { inScope: 2 } },
    {
      id: "each",
      foreach: "$trigger",
      sideBySide: 2,
      steps: [
        { id: "gate", action: "gate", input: { n: "$item" } },
        { id: "write", action: "draft", input: { topic: "$item" } },
        { id: "note", action: "pass", input: { noted: "$item" } },
      ],
    },
    { id: "card", approval: "Merge this wave?", show: "$settings.card", quotes: [...quotes] },
  ];
}

function cardOf(lines: readonly Line[]): Json {
  return { title: "Merge wave 1?", lines: lines.map((line) => ({ ...line })) };
}

function settingsWith(card: Json): Partial<Config> {
  return { settings: { notes: { greeting: "hello", card } } };
}

function changesOf(opening: Opening): Changes {
  const changes = { ...withFlow(cardSteps(opening.quotes ?? ["write", "note"])), notesActions: { pass, gate } };
  return { ...changes, config: settingsWith(cardOf(opening.lines)) };
}

function gateScript(
  failsFirst: number | undefined,
): (request: { readonly input: Json }) => ReturnType<typeof finished> {
  let failed = false;
  return (request) => {
    const item = numberField(request.input, "n");
    if (item === failsFirst && !failed) {
      failed = true;
      return failure(`item ${String(item)} is not ready`);
    }
    return finished(request.input);
  };
}

async function openedFor(opening: Opening): Promise<OpenedRuns> {
  return openedRuns({
    changes: changesOf(opening),
    scripts: { "notes:scripts/slow.ts": gateScript(opening.gateFailsFirst) },
  });
}

function waitsOf(run: Run): Waits {
  const state = run.state;
  assert.ok(state.status === "waiting", JSON.stringify(state));
  return [state.waiting, ...(state.alsoWaiting ?? [])];
}

async function answerSkills(runs: Runs, run: Run): Promise<Run> {
  let current = run;
  while (current.state.status === "waiting") {
    const skill = waitsOf(current).find((waiting) => waiting.reason === "skill");
    if (skill?.reason !== "skill") {
      return current;
    }
    const token = skill.task.token ?? tokenAfterReissue(runOf(await runs.reissueTask(current.id, skill.stepKey)));
    current = runOf(await runs.submit(token, answer({ text: `drafted for ${skill.stepKey}` })));
  }
  return current;
}

function tokenAfterReissue(run: Run): string {
  const skill = waitsOf(run).find((waiting) => waiting.reason === "skill" && waiting.task.token !== undefined);
  assert.ok(skill?.reason === "skill" && skill.task.token !== undefined, JSON.stringify(run.state));
  return skill.task.token;
}

async function atCard(opening: Opening): Promise<{ readonly run: Run; readonly opened: OpenedRuns }> {
  const opened = await openedFor(opening);
  const started = runOf(await opened.runs.start(flow, [0, 1]));
  return { run: await answerSkills(opened.runs, started), opened };
}

function endReason(run: Run): string {
  const state = run.state;
  assert.ok(state.status === "failed", JSON.stringify(state));
  return state.reason;
}

async function refusedCard(lines: readonly Line[], quotes?: readonly string[]): Promise<string> {
  const { run, opened } = await atCard(quotes === undefined ? { lines } : { lines, quotes });
  opened.close();
  assert.equal(run.steps.find((step) => step.key === "card")?.status, "failed");
  return endReason(run);
}

function cardShown(run: Run): Json {
  const [waiting] = waitsOf(run);
  assert.ok(waiting?.reason === "approval", JSON.stringify(run.state));
  return waiting.card ?? null;
}

const drafted = "the tests assert what each item says";

const draftSkill = { mode: "notes", skill: "skills/draft", tier: "balanced" as const };

const cannot = "Step card cannot show its card: line 1";

describe("a card on an approval after a foreach", () => {
  test("a judged line from an item's skill step is shown with its skill and its item, after a restart too", async () => {
    const lines = [
      { mark: "computed", words: "in scope: 2 of 2 paths", source: { step: "offer" } },
      { mark: "judged", words: drafted, source: { step: "write", item: 0 } },
      { mark: "judged", words: "item 1 holds", source: { step: "write", item: 1 } },
    ];
    const { run, opened } = await atCard({ lines });
    const expected = {
      title: "Merge wave 1?",
      lines: [
        { mark: "computed", words: "in scope: 2 of 2 paths", source: { step: "offer" } },
        { mark: "judged", words: drafted, source: { step: "write", item: 0 }, skills: [draftSkill], foreach: "each" },
        {
          mark: "judged",
          words: "item 1 holds",
          source: { step: "write", item: 1 },
          skills: [draftSkill],
          foreach: "each",
        },
      ],
      counted: { ran: 0, computed: 1, judged: 2 },
    };
    assert.deepEqual(cardShown(run), expected);
    opened.runs.close();
    const later = await opened.reopen();
    assert.deepEqual(cardShown(runOf(await later.show(run.id))), expected);
    opened.close();
  });

  test("a judged line that cites an item's script step is not passed off as a skill's", async () => {
    assert.equal(
      await refusedCard([{ mark: "judged", words: "noted", source: { step: "note", item: 1 } }]),
      `${cannot} is marked judged but cites step note in item 1 of each, which ran no skill; ` +
        "a judged line cites a skill step the approval lists under quotes.",
    );
  });

  test("a computed line that cites an item's skill step is not passed off as the script's", async () => {
    assert.equal(
      await refusedCard([{ mark: "computed", words: drafted, source: { step: "write", item: 1 } }]),
      `${cannot} is marked computed but cites step write in item 1 of each, which ran the skill ` +
        "skills/draft of mode notes; a computed line cites a step that ran no skill.",
    );
  });

  test("a judged line from an item's skill step the approval does not list under quotes is not shown", async () => {
    assert.equal(
      await refusedCard([{ mark: "judged", words: drafted, source: { step: "write", item: 0 } }], ["note"]),
      `${cannot} is marked judged but cites step write in item 0 of each, which the approval does not list ` +
        "under quotes (it lists: note).",
    );
  });

  test("a line that cites a step inside the items without naming its item is not shown", async () => {
    assert.equal(
      await refusedCard([{ mark: "judged", words: drafted, source: { step: "write" } }]),
      `${cannot} cites step write, which runs in each item of step each; a line names its item as source.item.`,
    );
  });

  test("a line that cites an item the foreach did not run is not shown", async () => {
    assert.equal(
      await refusedCard([{ mark: "judged", words: drafted, source: { step: "write", item: 2 } }]),
      `${cannot} cites step write in item 2 of each, which has not finished in this run before the approval.`,
    );
  });

  test("a line that names an item of a step outside any foreach is not shown", async () => {
    assert.equal(
      await refusedCard([{ mark: "computed", words: "in scope", source: { step: "offer", item: 0 } }]),
      `${cannot} cites item 0 of step offer, which is not a step inside a foreach.`,
    );
  });

  test("an item that is not a whole number from 0 is not shown", async () => {
    for (const item of [-1, 0.5, "1"]) {
      assert.equal(
        await refusedCard([{ mark: "judged", words: drafted, source: { step: "write", item } }]),
        `${cannot} has the source.item ${JSON.stringify(item)}; an item is counted from 0 as a whole number.`,
      );
    }
  });

  test("a line that names its own foreach is not shown: only the kernel says which foreach an item is of", async () => {
    const line = { mark: "judged", words: drafted, source: { step: "write", item: 0 }, foreach: "each" };
    assert.equal(
      await refusedCard([line]),
      `${cannot} has the field foreach, which a line does not take; a line has mark, words and source, ` +
        "and the kernel adds the skill and tier of a judged line and the foreach of a step in an item.",
    );
  });

  test("after an item failed and ran again, a line cites the attempt that finished, not the one that failed", async () => {
    const lines = [{ mark: "judged", words: drafted, source: { step: "write", item: 1 } }];
    const opened = await openedFor({ lines, gateFailsFirst: 1 });
    const started = runOf(await opened.runs.start(flow, [0, 1]));
    const asked = await answerSkills(opened.runs, started);
    assert.equal(waitsOf(asked)[0]?.reason, "owner");
    const rerun = await answerSkills(opened.runs, runOf(await opened.runs.resume(started.id, { rerun: true })));
    assert.deepEqual(cardShown(rerun), {
      title: "Merge wave 1?",
      lines: [{ ...lines[0], skills: [draftSkill], foreach: "each" }],
      counted: { ran: 0, computed: 0, judged: 1 },
    });
    assert.ok(rerun.steps.some((step) => step.key === "each[1]~2.write" && step.status === "done"));
    assert.ok(!rerun.steps.some((step) => step.key === "each[1].write"));
    opened.close();
  });

  test("an item's judged words are scrubbed of secrets as every card is", async () => {
    const lines = [{ mark: "judged", words: `the token is ${secretValue}`, source: { step: "write", item: 0 } }];
    const { run, opened } = await atCard({ lines });
    opened.close();
    const shown = JSON.stringify(cardShown(run));
    assert.ok(!shown.includes(secretValue), shown);
    assert.match(shown, /the token is \S+/);
  });

  test("a step under a foreach a test gave counts as given, with no skill named", async () => {
    const lines = [{ mark: "judged", words: drafted, source: { step: "write", item: 1 } }];
    const opened = await openedFor({ lines });
    const given = { offer: { inScope: 2 }, each: [{ noted: 0 }, { noted: 1 }] };
    const run = runOf(await opened.runs.startPart(notesFlow, [0, 1], { given }));
    opened.close();
    assert.deepEqual(cardShown(run), {
      title: "Merge wave 1?",
      lines: [{ ...lines[0], skills: [], foreach: "each" }],
      counted: { ran: 0, computed: 0, judged: 1 },
    });
  });
});

describe("which steps an approval may quote, checked when the workflow loads", () => {
  function quoting(steps: Workflow["steps"]): Changes {
    return { ...withFlow(steps), notesActions: { pass, gate } };
  }

  const drafting = { id: "write", action: "draft" };

  test("a step of an earlier foreach's own steps may be quoted", async () => {
    const steps: Workflow["steps"] = [
      { id: "each", foreach: "$trigger", steps: [drafting] },
      { id: "card", approval: "Merge?", quotes: ["write"] },
    ];
    await fixtureSystem(quoting(steps));
  });

  test("a step of a foreach that comes later, or of a foreach inside an item, may not", async () => {
    const steps: Workflow["steps"] = [
      { id: "outer", foreach: "$trigger", steps: [{ id: "inner", foreach: "$item", steps: [drafting] }] },
      { id: "card", approval: "Merge?", quotes: ["write", "later"] },
      { id: "after", foreach: "$trigger", steps: [{ id: "later", action: "draft" }] },
    ];
    const said = (id: string): string =>
      "Workflow workflows/flow.yaml of mode notes has a reference problem: the approval quotes the step " +
      `${id}, which is not defined before this step in its scope (earlier steps: outer; ` +
      "in the items of an earlier foreach: inner).";
    assert.deepEqual(await fixtureRefusal(quoting(steps)), [said("write"), said("later")]);
  });
});
