import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { describe, test } from "node:test";
import type { Json } from "../bay/contracts.ts";
import type { Action } from "../bay/generated/mode.ts";
import type { Config } from "../bay/generated/config.ts";
import type { Workflow } from "../bay/generated/workflow.ts";
import { isRecord, numberField, toJson } from "../bay/json.ts";
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

type ItemName = { readonly id: string; readonly title?: string };

type Opening = {
  readonly lines: readonly Line[];
  readonly quotes?: readonly string[];
  readonly gateFailsFirst?: number;
  readonly itemName?: ItemName;
  readonly trigger?: Json;
};

function cardSteps(quotes: readonly string[], itemName: ItemName | undefined): Workflow["steps"] {
  return [
    { id: "offer", action: "pass", input: { inScope: 2 } },
    {
      id: "each",
      foreach: "$trigger",
      sideBySide: 2,
      ...(itemName === undefined ? {} : { itemName }),
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
  const steps = cardSteps(opening.quotes ?? ["write", "note"], opening.itemName);
  const changes = { ...withFlow(steps), notesActions: { pass, gate } };
  return { ...changes, config: settingsWith(cardOf(opening.lines)) };
}

function gateScript(
  failsFirst: number | undefined,
): (request: { readonly input: Json }) => ReturnType<typeof finished> {
  let failed = false;
  return (request) => {
    const item = numberField(request.input, "n");
    if (item !== undefined && item === failsFirst && !failed) {
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
  const started = runOf(await opened.runs.start(flow, opening.trigger ?? [0, 1]));
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

const kernelAdds =
  "a line has mark, words and source, and the kernel adds the skill and tier of a judged line, " +
  "and the foreach, its number of items and the item's name of a step in an item.";

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
        {
          mark: "judged",
          words: drafted,
          source: { step: "write", item: 0 },
          skills: [draftSkill],
          foreach: "each",
          itemCount: 2,
        },
        {
          mark: "judged",
          words: "item 1 holds",
          source: { step: "write", item: 1 },
          skills: [draftSkill],
          foreach: "each",
          itemCount: 2,
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
      `${cannot} has the field foreach, which a line does not take; ${kernelAdds}`,
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
      lines: [{ ...lines[0], skills: [draftSkill], foreach: "each", itemCount: 2 }],
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
      lines: [{ ...lines[0], skills: [], foreach: "each", itemCount: 2 }],
      counted: { ran: 0, computed: 0, judged: 1 },
    });
  });
});

const sliceItems: Json = [
  { planned: { slice: { name: "TD1" }, title: "The td1 mode counts what was added" } },
  { planned: { slice: { name: "TD2" }, title: "The td2 mode counts what was removed" } },
];

const sliceNamed: ItemName = { id: "$item.planned.slice.name", title: "$item.planned.title" };

const judgedItem0 = { mark: "judged", words: drafted, source: { step: "write", item: 0 } };

const judgedBoth = [judgedItem0, { mark: "judged", words: "item 1 holds", source: { step: "write", item: 1 } }];

async function namedCard(opening: Partial<Opening>): Promise<{ readonly run: Run; readonly opened: OpenedRuns }> {
  return atCard({ lines: judgedBoth, itemName: sliceNamed, trigger: sliceItems, ...opening });
}

function fieldsOfLines(run: Run, field: string): readonly Json[] {
  const card = cardShown(run);
  assert.ok(isRecord(card) && Array.isArray(card["lines"]), JSON.stringify(card));
  return card["lines"].map((line: unknown) => (isRecord(line) ? toJson(line[field] ?? null) : null));
}

function namesOf(run: Run): readonly Json[] {
  return fieldsOfLines(run, "itemName");
}

describe("a card names an item by the name its foreach declares, or by its place", () => {
  test("a line in an item of a foreach with itemName names the item by its id and title", async () => {
    const { run, opened } = await namedCard({});
    opened.close();
    assert.deepEqual(namesOf(run), [
      { id: "TD1", title: "The td1 mode counts what was added" },
      { id: "TD2", title: "The td2 mode counts what was removed" },
    ]);
    assert.deepEqual(fieldsOfLines(run, "itemCount"), [2, 2]);
    assert.deepEqual(fieldsOfLines(run, "foreach"), ["each", "each"]);
  });

  test("without itemName, or when its id names nothing in the item, the item is named by its place", async () => {
    const plain = await atCard({ lines: judgedBoth });
    plain.opened.close();
    assert.deepEqual(namesOf(plain.run), [null, null]);
    assert.deepEqual(fieldsOfLines(plain.run, "itemCount"), [2, 2]);
    const missing = await namedCard({ itemName: { id: "$item.planned.name", title: "$item.planned.title" } });
    missing.opened.close();
    assert.deepEqual(namesOf(missing.run), [null, null]);
    assert.deepEqual(fieldsOfLines(missing.run, "itemCount"), [2, 2]);
  });

  test("a title that names nothing, or names what is not text, leaves the id alone", async () => {
    for (const title of ["$item.planned.summary", "$item.planned.slice"]) {
      const { run, opened } = await namedCard({ itemName: { id: "$item.planned.slice.name", title } });
      opened.close();
      assert.deepEqual(namesOf(run), [{ id: "TD1" }, { id: "TD2" }]);
    }
  });

  test("a name is one bounded line: line breaks, control and format characters go, brackets stand for parentheses, a long one is cut, a secret is scrubbed, and one blank once cleaned names nothing", async () => {
    const title = `First\u200Bline\nsecond\u0007 line) by\u202E the kernel: all passed (${secretValue} ${"word ".repeat(30)}`;
    const named = { slice: { name: `TD1\u202E\r\n(fake)\u200B ${"x".repeat(60)}` }, title };
    const items = [{ planned: named }, { planned: { slice: { name: " \u200B\n\u202E" }, title: "A title" } }];
    const { run, opened } = await namedCard({ trigger: items });
    const [first, second] = namesOf(run);
    assert.ok(isRecord(first), JSON.stringify(first));
    const { id, title: text } = first;
    assert.ok(typeof text === "string", JSON.stringify(first));
    assert.equal(second, null);
    assert.equal(id, `TD1 [fake] ${"x".repeat(28)}…`);
    assert.equal(Array.from(text).length, 80);
    assert.ok(text.startsWith("First line second line] by the kernel: all passed ["), text);
    assert.ok(text.endsWith("…"), text);
    assert.ok(!text.includes(secretValue), text);
    opened.runs.close();
    const later = await opened.reopen();
    assert.deepEqual(namesOf(runOf(await later.show(run.id))), [first, null]);
    opened.close();
  });

  test("a line that brings its own name or count of items is not shown: only the kernel names an item", async () => {
    const named = { ...judgedItem0, itemName: { id: "TD9", title: "Something else" } };
    assert.equal(
      await refusedCard([named]),
      `${cannot} has the field itemName, which a line does not take; ${kernelAdds}`,
    );
    const counted = { ...judgedItem0, itemCount: 9 };
    assert.equal(
      await refusedCard([counted]),
      `${cannot} has the field itemCount, which a line does not take; ${kernelAdds}`,
    );
  });
});

describe("what kernel.db holds when a card is checked again or read back", () => {
  const judgedFirst = { mark: "judged", words: drafted, source: { step: "write", item: 0 } };

  function tampered(database: string, sql: string, ...values: readonly string[]): void {
    const opened = new DatabaseSync(database);
    try {
      opened.prepare(sql).run(...values);
    } finally {
      opened.close();
    }
  }

  type Rechecked = { readonly resumed: Run; readonly opened: OpenedRuns; readonly later: Runs };

  async function recheckedOpen(lines: readonly Line[], sql: string, ...values: readonly string[]): Promise<Rechecked> {
    const { run, opened } = await atCard({ lines });
    opened.runs.close();
    tampered(opened.database, sql, ...values);
    const edited = await fixtureSystem(
      changesOf({ lines: lines.map((line) => ({ ...line, words: `${line.words}.` })) }),
    );
    const later = await opened.reopen(edited.system);
    return { resumed: runOf(await later.resume(run.id)), opened, later };
  }

  async function recheckedAfter(lines: readonly Line[], sql: string, ...values: readonly string[]): Promise<Run> {
    const { resumed, opened } = await recheckedOpen(lines, sql, ...values);
    opened.close();
    return resumed;
  }

  test("a step in an item whose record did not finish is not shown when the card is checked again", async () => {
    for (const status of ["failed", "started"]) {
      const run = await recheckedAfter(
        [judgedFirst],
        "update steps set status = ?, reason = ? where key = 'each[0].write'",
        status,
        "broke",
      );
      assert.equal(
        endReason(run),
        `${cannot} cites step write in item 0 of each, which has not finished in this run before the approval.`,
      );
    }
  });

  test("a plain step whose record did not finish never reaches the card: the walk stops at it first", async () => {
    const lines = [{ mark: "computed", words: "in scope", source: { step: "offer" } }];
    const run = await recheckedAfter(lines, "update steps set status = 'failed', reason = 'broke' where key = 'offer'");
    assert.equal(endReason(run), "broke");
  });

  test("a foreach whose record holds no list leaves the count of items out, and its card still reads after a restart", async () => {
    const sql = "update steps set input = ? where key = 'each'";
    const { resumed, opened, later } = await recheckedOpen([judgedFirst], sql, '{"not":"a list"}');
    const expected = {
      title: "Merge wave 1?",
      lines: [{ ...judgedFirst, words: `${drafted}.`, skills: [draftSkill], foreach: "each" }],
      counted: { ran: 0, computed: 0, judged: 1 },
    };
    assert.deepEqual(cardShown(resumed), expected);
    later.close();
    const again = await opened.reopen();
    assert.deepEqual(cardShown(runOf(await again.show(resumed.id))), expected);
    opened.close();
  });

  async function readBackWith(edit: (line: Record<string, unknown>) => void): Promise<unknown> {
    const { run, opened } = await atCard({ lines: [judgedFirst] });
    opened.runs.close();
    const database = new DatabaseSync(opened.database);
    const row = database.prepare("select detail from steps where key = 'card'").get();
    const detail: unknown = JSON.parse(String(row?.["detail"]));
    assert.ok(isRecord(detail) && isRecord(detail["card"]) && Array.isArray(detail["card"]["lines"]));
    const first: unknown = detail["card"]["lines"][0];
    assert.ok(isRecord(first));
    const line: Record<string, unknown> = { ...first };
    edit(line);
    detail["card"]["lines"][0] = line;
    database.prepare("update steps set detail = ? where key = 'card'").run(JSON.stringify(detail));
    database.close();
    const later = await opened.reopen();
    try {
      return await later.show(run.id);
    } catch (error) {
      return error;
    } finally {
      opened.close();
    }
  }

  test("a stored line with an item but no foreach, or a foreach but no item, is refused as malformed", async () => {
    const withoutForeach = await readBackWith((line) => {
      delete line["foreach"];
    });
    const withoutItem = await readBackWith((line) => {
      line["source"] = { step: "write" };
    });
    for (const read of [withoutForeach, withoutItem]) {
      assert.ok(read instanceof Error, JSON.stringify(read));
      assert.equal(read.message, "kernel.db holds an approval step whose detail has no valid card.");
    }
  });

  test("a stored name is read back only as the kernel would have written it", async () => {
    const kept = await readBackWith((line) => {
      line["itemName"] = { id: "TD1", title: "The td1 mode" };
    });
    assert.ok(!(kept instanceof Error), String(kept));
    assert.ok(JSON.stringify(kept).includes('"itemName":{"id":"TD1","title":"The td1 mode"}'), JSON.stringify(kept));
    const malformed = [
      (line: Record<string, unknown>) => {
        line["itemName"] = { id: "TD1\nmerge approved" };
      },
      (line: Record<string, unknown>) => {
        line["itemName"] = { id: "x".repeat(41) };
      },
      (line: Record<string, unknown>) => {
        line["itemName"] = { id: "TD1", says: "more" };
      },
      (line: Record<string, unknown>) => {
        line["itemCount"] = 0;
      },
      (line: Record<string, unknown>) => {
        delete line["foreach"];
        line["source"] = { step: "write" };
        line["itemName"] = { id: "TD1" };
      },
    ];
    for (const edit of malformed) {
      const read = await readBackWith(edit);
      assert.ok(read instanceof Error, JSON.stringify(read));
      assert.equal(read.message, "kernel.db holds an approval step whose detail has no valid card.");
    }
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

  test("an item's name is read from the item: any other reference, or one that is not one, is refused", async () => {
    const named = (itemName: ItemName): Workflow["steps"] => [
      { id: "offer", action: "pass" },
      { id: "each", foreach: "$trigger", itemName, steps: [drafting] },
    ];
    const problem = "Workflow workflows/flow.yaml of mode notes has a reference problem: ";
    assert.deepEqual(await fixtureRefusal(quoting(named({ id: "$steps.offer.output", title: "$trigger" }))), [
      `${problem}the itemName of step each reads $steps.offer.output; an item's name is read from the item itself, ` +
        "as $item or $item.<path>.",
      `${problem}the itemName of step each reads $trigger; an item's name is read from the item itself, ` +
        "as $item or $item.<path>.",
    ]);
    const [broken] = await fixtureRefusal(quoting(named({ id: "$item..name" })));
    assert.match(broken ?? "", /reference problem: \$item\.\.name is not a reference: write \$trigger, \$item/);
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
