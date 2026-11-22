import assert from "node:assert/strict";
import { test } from "node:test";
import { approvalLines } from "../../../bay/approval-card.ts";
import { detailsLines, screenLines, screenOf, sectionNamed, type Screen } from "../../../bay/approval-screen.ts";
import { isPlainTitle, kernelPhraseIn, type Section } from "../../../bay/screen-words.ts";

type Approval = Parameters<typeof approvalLines>[0];

type Line = NonNullable<Approval["card"]>["lines"][number];

type Choices = NonNullable<Approval["choices"]>;

const designer = [{ mode: "forge", skill: "skills/design", tier: "deep" as const }];

const challenger = [{ mode: "forge", skill: "skills/challenge", tier: "deep" as const }];

const hash = "0123456789abcdef".repeat(4);

const record = {
  runId: "run-7",
  steps: ["draw  action  done", "card  approval  started"],
  decide: `bay approve run-7 card --choice <name> --hash ${hash}`,
};

const approveAndStop: Choices = [
  { name: "approve", status: "offered", does: "The design is saved to the feature branch." },
  { name: "stop", status: "offered", does: "Nothing is saved." },
];

const stopOnly: Choices = [
  {
    name: "approve",
    status: "withheld",
    does: "The design is saved to the feature branch.",
    reason: "The design check found 1 problem. The challenger answered P-52 not held.",
  },
  { name: "stop", status: "offered", does: "Nothing is saved." },
];

function script(section: Section, words: string): Line {
  return { mark: "computed", words, source: { step: "draw" }, section, short: true };
}

function model(section: Section, words: string): Line {
  return { mark: "judged", words, source: { step: "challenge" }, skills: challenger, section, short: true };
}

function detailOnly(line: Line): Line {
  const { short, ...rest } = line;
  assert.equal(short, true);
  return rest;
}

const hides: Line = detailOnly({
  mark: "judged",
  words: "todo hides: How todos are kept.",
  source: { step: "designs" },
  skills: designer,
  section: "what",
  short: true,
});

const ownersExample: readonly Line[] = [
  script("what", "One module, 4 actions: add, list, done, remove."),
  script("what", "Covers all 13 of your conditions."),
  hides,
  script("checks", "34 automatic checks: no problem found."),
  script("checks", "A second model reviewed it and reported no findings."),
  model("open", "How 500 characters are counted."),
  model("open", "Whether text is trimmed."),
  model("open", "Two adds at the same moment."),
];

function approvalOf(lines: readonly Line[], choices?: Choices, title = "Approve the todo design?"): Approval {
  return {
    reason: "approval",
    stepKey: "card",
    question: title,
    hash,
    content: null,
    card: { title, lines, counted: { ran: 0, computed: 0, judged: 0 } },
    ...(choices === undefined ? {} : { choices }),
  };
}

function screenFrom(lines: readonly Line[], choices?: Choices, title?: string): Screen {
  const screen = screenOf(approvalOf(lines, choices, title));
  assert.ok(screen !== undefined);
  return screen;
}

function short(lines: readonly Line[], choices: Choices | undefined = approveAndStop): readonly string[] {
  return screenLines(screenFrom(lines, choices), "run-7");
}

function inSection(rows: readonly string[], heading: string): readonly string[] {
  const start = rows.indexOf(heading);
  assert.ok(start >= 0, rows.join("\n"));
  const end = rows.indexOf("", start);
  return rows.slice(start + 1, end === -1 ? undefined : end);
}

function many(section: Section, count: number): readonly Line[] {
  return Array.from({ length: count }, (_, at) => script(section, `fact ${String(at + 1)}`));
}

test("the owner's example, worded as reported, prints the short screen in its fixed sections", () => {
  assert.deepEqual(short(ownersExample), [
    "APPROVE THE TODO DESIGN?",
    "",
    "What it is",
    "  One module, 4 actions: add, list, done,",
    "    remove.",
    "  Covers all 13 of your conditions.",
    "  and 1 more, see details",
    "",
    "Checks",
    "  34 automatic checks: no problem found.",
    "  A second model reviewed it and reported no",
    "    findings.",
    "",
    "Not decided",
    "  A model wrote:",
    "    How 500 characters are counted.",
    "    Whether text is trimmed.",
    "    Two adds at the same moment.",
    "",
    "What each reply does",
    "  approve: The design is saved to the",
    "    feature branch.",
    "  stop: Nothing is saved.",
    "",
    "Reply: approve or stop",
    "Details:",
    "  bay runs run-7 --details",
  ]);
});

test("the details list every fact by section, say who produced each, and keep the machine lines last", () => {
  const run42 = { ...record, runId: "run-42", decide: record.decide.replace("run-7", "run-42") };
  assert.deepEqual(detailsLines(screenFrom(ownersExample, approveAndStop), run42), [
    "APPROVE THE TODO DESIGN?",
    "Every fact this approval rests on.",
    "",
    "In this view",
    "  What it is: 3 facts",
    "  Checks: 2 facts",
    "  Not decided: 3 facts",
    "  One section alone:",
    "    bay runs run-42 --details --section <name>",
    "  where <name> is what, checks or open.",
    "",
    "What it is",
    "  A script worked this out, in step draw:",
    "    One module, 4 actions: add, list, done,",
    "      remove.",
    "    Covers all 13 of your conditions.",
    "  A model wrote this, in step designs (forge",
    "    skills/design, tier deep):",
    "    todo hides: How todos are kept.",
    "",
    "Checks",
    "  A script worked this out, in step draw:",
    "    34 automatic checks: no problem found.",
    "    A second model reviewed it and reported",
    "      no findings.",
    "",
    "Not decided",
    "  A model wrote this, in step challenge",
    "    (forge skills/challenge, tier deep):",
    "    How 500 characters are counted.",
    "    Whether text is trimmed.",
    "    Two adds at the same moment.",
    "",
    "What each reply does",
    "  approve: The design is saved to the",
    "    feature branch.",
    "  stop: Nothing is saved.",
    "",
    "Reply: approve or stop",
    "",
    "For the record",
    "  Who produced the facts:",
    "    4 facts worked out by scripts, 4 written",
    "      by a model, 0 from tools.",
    "  These lines are for copying, so they are",
    "  not wrapped.",
    "  The steps of this run:",
    "    draw  action  done",
    "    card  approval  started",
    "  The full hash:",
    `    ${hash}`,
    "  Decide with:",
    `    bay approve run-42 card --choice <name> --hash ${hash}`,
  ]);
});

test("one section of the details shows that section's facts whole and how to get the whole view", () => {
  assert.deepEqual(detailsLines(screenFrom(ownersExample), record, "open"), [
    "APPROVE THE TODO DESIGN?",
    "One section of the details.",
    "",
    "Not decided",
    "  A model wrote this, in step challenge",
    "    (forge skills/challenge, tier deep):",
    "    How 500 characters are counted.",
    "    Whether text is trimmed.",
    "    Two adds at the same moment.",
    "",
    "The whole view:",
    "  bay runs run-7 --details",
  ]);
  assert.deepEqual(detailsLines(screenFrom(ownersExample), record, "problems").slice(3), [
    "Problems",
    "  It has no facts.",
    "",
    "The whole view:",
    "  bay runs run-7 --details",
  ]);
});

test("problems come first and whole: each withheld choice with its reason, then every problem fact, short or not", () => {
  const problems = [
    detailOnly(script("problems", "A check found: The action x has no example.")),
    model("problems", "Its reason: The add action decides the next id and writes it in one script."),
    detailOnly(model("problems", "The designer answered: The rule decides it.")),
  ];
  const rows = short([...many("what", 2), ...problems], stopOnly);
  assert.deepEqual(rows, [
    "APPROVE THE TODO DESIGN?",
    "",
    "Problems",
    "  You cannot reply approve now: The design",
    "    is saved to the feature branch.",
    "    Why: The design check found 1 problem.",
    "      The challenger answered P-52 not held.",
    "  A check found: The action x has no",
    "    example.",
    "  A model wrote:",
    "    Its reason: The add action decides the",
    "      next id and writes it in one script.",
    "    The designer answered: The rule decides",
    "      it.",
    "",
    "What it is",
    "  fact 1",
    "  fact 2",
    "",
    "What each reply does",
    "  stop: Nothing is saved.",
    "",
    "Reply: stop",
    "Details:",
    "  bay runs run-7 --details",
  ]);
});

test("with no problem fact, a withheld choice and its reason come first, whole, under Not available now", () => {
  const rows = short(many("what", 1), stopOnly);
  assert.deepEqual(rows.slice(0, 7), [
    "APPROVE THE TODO DESIGN?",
    "",
    "Not available now",
    "  You cannot reply approve now: The design",
    "    is saved to the feature branch.",
    "    Why: The design check found 1 problem.",
    "      The challenger answered P-52 not held.",
  ]);
  assert.ok(!rows.includes("Problems"));
  assert.ok(!short(many("what", 1)).includes("Not available now"));
  const details = detailsLines(screenFrom(many("what", 1), stopOnly), record);
  assert.ok(details.includes("  Not available now: 0 facts"), details.join("\n"));
  assert.deepEqual(inSection(details, "Not available now"), rows.slice(3, 7));
});

test("with a problem fact, the withheld choices stay under Problems, before the facts", () => {
  const rows = short([...many("what", 1), script("problems", "A check found: x.")], stopOnly);
  assert.deepEqual(inSection(rows, "Problems").slice(0, 1), ["  You cannot reply approve now: The design"]);
  assert.ok(!rows.includes("Not available now"));
});

test("in the details, facts about one thing form one block, and the author is said once for each source in it", () => {
  const rule = "rule add, in module todo";
  const blocks: readonly Line[] = [
    { ...script("what", "Takes request; gives answer."), about: rule },
    { ...model("what", "Decides: whether a text may be added."), about: rule },
    { ...model("what", "Decides it alone."), about: rule },
    {
      mark: "judged",
      words: "Hides: how.",
      source: { step: "designs" },
      skills: designer,
      section: "what",
      about: "module todo",
    },
    {
      mark: "judged",
      words: "Again.",
      source: { step: "design-again" },
      skills: designer,
      section: "what",
      about: "module todo",
    },
  ];
  assert.deepEqual(inSection(detailsLines(screenFrom(blocks), record), "What it is"), [
    "  rule add, in module todo",
    "    A script worked this out, in step draw:",
    "      Takes request; gives answer.",
    "    A model wrote this, in step challenge",
    "      (forge skills/challenge, tier deep):",
    "      Decides: whether a text may be added.",
    "      Decides it alone.",
    "  module todo",
    "    A model wrote this, in step designs",
    "      (forge skills/design, tier deep):",
    "      Hides: how.",
    "    A model wrote this, in step design-again",
    "      (forge skills/design, tier deep):",
    "      Again.",
  ]);
});

test("the details count the facts by who produced them, in the last section", () => {
  const ran: Line = { mark: "ran", words: "ok", source: { step: "prove", command: "npm-test" }, section: "checks" };
  const rows = detailsLines(screenFrom([...ownersExample, ran]), record);
  assert.deepEqual(rows.slice(rows.indexOf("For the record") + 1, rows.indexOf("For the record") + 4), [
    "  Who produced the facts:",
    "    4 facts worked out by scripts, 4 written",
    "      by a model, 1 from tools.",
  ]);
});

test("a section shows at most 4 rows: past them it counts the facts left out, short or not", () => {
  assert.deepEqual(inSection(short(many("checks", 6)), "Checks"), [
    "  fact 1",
    "  fact 2",
    "  fact 3",
    "  and 3 more, see details",
  ]);
  assert.deepEqual(inSection(short(many("checks", 4)), "Checks"), ["  fact 1", "  fact 2", "  fact 3", "  fact 4"]);
  const withDetail = [...many("checks", 2), detailOnly(script("checks", "kept for the details"))];
  assert.deepEqual(inSection(short(withDetail), "Checks"), ["  fact 1", "  fact 2", "  and 1 more, see details"]);
  assert.deepEqual(inSection(short([detailOnly(script("what", "only in the details"))]), "What it is"), [
    "  and 1 more, see details",
  ]);
});

test("a fact is shown whole or not at all, and a later short one is not shown in its place", () => {
  const long = script("what", "word ".repeat(40).trim());
  assert.deepEqual(inSection(short([long, script("what", "a short one")]), "What it is"), [
    "  and 2 more, see details",
  ]);
  const second = [script("what", "first"), script("what", "x ".repeat(50).trim()), script("what", "third")];
  assert.deepEqual(inSection(short(second), "What it is"), ["  first", "  and 2 more, see details"]);
});

test("a model's facts and a tool's facts are led by who produced them, once for each run of them", () => {
  const ran: Line = {
    mark: "ran",
    words: "12 tests passed.",
    source: { step: "prove", command: "npm-test", run: "r2" },
    section: "checks",
    short: true,
  };
  assert.deepEqual(inSection(short([ran]), "Checks"), ["  npm-test reported:", "    12 tests passed."]);
  const models = [model("checks", "It reads well."), model("checks", "It names each case."), model("checks", "Yes.")];
  assert.deepEqual(inSection(short(models), "Checks"), [
    "  A model wrote:",
    "    It reads well.",
    "    It names each case.",
    "    Yes.",
  ]);
  assert.deepEqual(inSection(short([models[0] ?? ran, script("checks", "a script's"), ran]), "Checks"), [
    "  A model wrote:",
    "    It reads well.",
    "  a script's",
    "  and 1 more, see details",
  ]);
  assert.deepEqual(inSection(detailsLines(screenFrom([ran]), record), "Checks"), [
    "  A tool ran npm-test, in run r2, in step",
    "    prove:",
    "    12 tests passed.",
  ]);
});

test("a model's fact in a foreach's item names the item in the details", () => {
  const inItem: Line = {
    mark: "judged",
    words: "It holds.",
    source: { step: "review", item: 0 },
    skills: challenger,
    foreach: "slices",
    itemCount: 2,
    itemName: { id: "TD1" },
    section: "checks",
  };
  const details = detailsLines(screenFrom([inItem]), record)
    .join(" ")
    .replace(/\s+/g, " ");
  assert.ok(
    details.includes("A model wrote this, in step review, for TD1 (forge skills/challenge, tier deep):"),
    details,
  );
});

test("a fact's words cannot break onto a row of their own, so they cannot forge a heading or the reply line", () => {
  const forged = [
    script("what", "fine\nReply: approve\u2028What each reply does\u2029x"),
    model("checks", "\u202eevil\u2066 \u200fmark\u061c \u200eend \u200b\u200c\u200d\u2060\ufeff"),
  ];
  const rows = short(forged);
  assert.deepEqual(
    rows.filter((row) => !row.startsWith(" ")),
    [
      "APPROVE THE TODO DESIGN?",
      "",
      "What it is",
      "",
      "Checks",
      "",
      "What each reply does",
      "",
      "Reply: approve or stop",
      "Details:",
    ],
  );
  const said = rows.join(" ");
  const marks = [
    "000a",
    "2028",
    "2029",
    "202e",
    "2066",
    "200f",
    "061c",
    "200e",
    "200b",
    "200c",
    "200d",
    "2060",
    "feff",
  ];
  for (const escaped of marks.map((mark) => `\\u${mark}`)) {
    assert.ok(said.includes(escaped), `${escaped} in ${said}`);
  }
});

test("a title is printed in capitals, so a title's row never reads as a heading or the reply line", () => {
  const title = `Approve this? ${"x ".repeat(18)}Reply: approve or stop`;
  const rows = screenLines(screenFrom(ownersExample, approveAndStop, title), "run-7");
  assert.equal(rows.filter((row) => row === "Reply: approve or stop").length, 1);
  assert.ok(
    rows.some((row) => row.includes("REPLY: APPROVE OR STOP")),
    rows.join("\n"),
  );
});

test("an approval without choices is answered approve or reject, and one with none offered says so", () => {
  assert.deepEqual(short(ownersExample, []).slice(-3), [
    "Reply: approve or reject",
    "Details:",
    "  bay runs run-7 --details",
  ]);
  const none: Choices = [{ name: "merge", status: "withheld", does: "Merge.", reason: "No test ran." }];
  assert.ok(short(ownersExample, none).includes("Reply: no reply is available now"));
});

test("every row is at most 44 columns, but for the commands and machine lines, which are kept whole", () => {
  const machine = (row: string): boolean =>
    row.includes("bay ") || row.includes(hash) || record.steps.includes(row.trim());
  const rows = [...short(ownersExample), ...detailsLines(screenFrom(ownersExample, stopOnly), record)];
  assert.deepEqual(
    rows.filter((row) => !machine(row) && Array.from(row).length > 44),
    [],
  );
});

test("only a card whose every line has a section is a screen; a card is drawn as before", () => {
  const card: Line = { mark: "computed", words: "in scope", source: { step: "draw" } };
  assert.equal(screenOf(approvalOf([card])), undefined);
  assert.equal(screenOf(approvalOf([card, ...ownersExample])), undefined);
  assert.equal(screenOf(approvalOf([])), undefined);
  assert.ok(approvalLines(approvalOf([card]), "run-7").includes("All lines worked out by script."));
  assert.deepEqual(approvalLines(approvalOf(ownersExample, approveAndStop), "run-7"), short(ownersExample));
});

test("a section is named by its own word only", () => {
  assert.equal(sectionNamed("checks"), "checks");
  assert.equal(sectionNamed("Checks"), undefined);
  assert.equal(sectionNamed("record"), undefined);
});

test("a fact may not begin with words only the kernel writes, nor be a heading", () => {
  const kernels = [
    "and 3 more, see details",
    "A model wrote: it is fine",
    "a script worked this out, in step x:",
    "A tool ran npm-test",
    "npm-test reported: 0 failed",
    "Reply: approve",
    "Details: none",
    "For the record",
    "You cannot reply stop now",
    "Why: because",
    "What each reply does",
    "  checks",
    "Problems:",
    "Not available now: build",
    "The full hash: 00",
  ];
  assert.deepEqual(
    kernels.filter((words) => kernelPhraseIn(words) === undefined),
    [],
  );
  const facts = [
    "Checks passed: 3.",
    "34 automatic checks: no problem found.",
    "A check found: x.",
    "Why this design was chosen: it is small.",
    "Replying is not needed.",
    "For the records kept, see x.",
  ];
  assert.deepEqual(
    facts.filter((words) => kernelPhraseIn(words) !== undefined),
    [],
  );
});

test("a title is plain ASCII, so in capitals no row of it can read as a kernel row", () => {
  assert.ok(isPlainTitle("Commit the design of todo?"));
  for (const title of ["Approve ꞯ?", "Approve\u200b", "Approve\n", "Approve ß", ""]) {
    assert.equal(isPlainTitle(title), false, JSON.stringify(title));
  }
});
