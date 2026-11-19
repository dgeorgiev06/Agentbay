import assert from "node:assert/strict";
import { test } from "node:test";
import { stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, textField, toJson } from "../bay/json.ts";
import { bay, fakeTerminal, listOf, type Ran } from "./cli-fixture.ts";
import { makeProject, type Project, type ProjectOptions } from "./project-fixture.ts";

const rawOnly = '"source"';

const offerScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input) => {",
  '  const merge = typeof input === "object" && input !== null && "merge" in input && input.merge === true;',
  "  const lines = [",
  `    { mark: "computed", words: "in scope: 11 of 11 paths", source: { step: "offer" } },`,
  `    { mark: "computed", words: "checks: 5 of 5 passed", source: { step: "offer" } },`,
  "  ];",
  '  const withheld = merge ? {} : { withheld: { merge: "1 must item is inconclusive." } };',
  '  return { card: { title: "Merge TR2 into feat/0022-agentbay5?", lines, ...withheld }, merge };',
  "});",
  "",
].join("\n");

const takenScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input) => input);",
  "",
].join("\n");

function scriptAction(script: string): object {
  return {
    description: "When a merge workflow needs it.",
    input: "schemas/anything.json",
    output: "schemas/anything.json",
    effects: ["read"],
    run: [{ script }],
  };
}

const mergerMode = {
  name: "merger",
  version: "1.0.0",
  description: "Draws a merge card from what proof found.",
  actions: { offer: scriptAction("scripts/offer.ts"), taken: scriptAction("scripts/taken.ts") },
  workflows: ["workflows/merge.yaml"],
};

const mergeWorkflow = {
  name: "merge",
  trigger: { manual: true },
  steps: [
    { id: "offer", action: "offer" },
    {
      id: "card",
      approval: "Merge this slice?",
      show: "$steps.offer.output.card",
      choices: {
        merge: { when: "$steps.offer.output.merge", does: "Merge into feat/0022-agentbay5" },
        keep: { does: "Stop; forge/tr2 stays" },
        discard: { does: "Stop; forge/tr2 is removed" },
      },
    },
    { id: "after", action: "taken", input: { taken: "$steps.card.output.choice" } },
  ],
};

const offeredHash = "04f8a7d665a4705f18505c352846b6703a0d9ed929f56b4b37b096f255cc3484";

const withheldHash = "93762d2d5c9d44c288153a77e0373e82534d8b89f44e31be0ad22df424c09ba9";

const stepsListed = ["steps:", "  offer  action  done", "  offer/0  script  done", "  card  approval  started"].join(
  "\n",
);

type Stopped = {
  readonly project: Project;
  readonly runId: string;
  readonly hash: string;
};

async function mergerProject(options: ProjectOptions = {}): Promise<Project> {
  const project = await makeProject(options);
  const folder = "components/modes/merger";
  await project.write(`${folder}/mode.yaml`, stringify(mergerMode));
  await project.write(`${folder}/schemas/anything.json`, `${JSON.stringify({ type: "object" })}\n`);
  await project.write(`${folder}/scripts/offer.ts`, offerScript);
  await project.write(`${folder}/scripts/taken.ts`, takenScript);
  await project.write(`${folder}/workflows/merge.yaml`, stringify(mergeWorkflow));
  return project;
}

function callArgv(project: Project, merge: boolean): readonly string[] {
  const input = JSON.stringify({ merge });
  return ["call", "--workflow", "merger:workflows/merge.yaml", input, "--project", project.root];
}

async function stoppedAt(project: Project, merge: boolean): Promise<Stopped> {
  const called = await bay([...callArgv(project, merge), "--json"]);
  const run = fieldOf(toJson(called.json), "run") ?? null;
  const waiting = fieldOf(run, "waiting") ?? null;
  assert.equal(textField(waiting, "reason"), "approval", called.output);
  return { project, runId: textField(run, "id") ?? "", hash: textField(waiting, "hash") ?? "" };
}

async function withStopped(
  setting: { readonly merge: boolean; readonly options?: ProjectOptions },
  body: (stopped: Stopped) => Promise<void>,
): Promise<void> {
  const project = await mergerProject(setting.options);
  try {
    await body(await stoppedAt(project, setting.merge));
  } finally {
    await project.remove();
  }
}

function approveArgv(stopped: Stopped, ...rest: readonly string[]): readonly string[] {
  return ["approve", stopped.runId, "card", ...rest, "--project", stopped.project.root];
}

function withId(text: string, stopped: Stopped): string {
  return text.replaceAll(stopped.runId, "<run>");
}

function offeredCard(hash: string): string {
  return [
    "run <run> (workflow merger:workflows/merge.yaml): waiting for approval at card",
    "Merge TR2 into feat/0022-agentbay5?",
    "  in scope: 11 of 11 paths",
    "  checks: 5 of 5 passed",
    "All lines worked out by script.",
    "You can:",
    "  merge    Merge into feat/0022-agentbay5",
    "  keep     Stop; forge/tr2 stays",
    "  discard  Stop; forge/tr2 is removed",
    "checked: 0 ran, 2 computed, 0 judged",
    `hash ${hash.slice(0, 12)}`,
    `decide with: bay approve <run> card --choice <name> --hash ${hash}`,
  ].join("\n");
}

function withheldCard(hash: string): string {
  return [
    "run <run> (workflow merger:workflows/merge.yaml): waiting for approval at card",
    "Merge TR2 into feat/0022-agentbay5?",
    "  in scope: 11 of 11 paths",
    "  checks: 5 of 5 passed",
    "All lines worked out by script.",
    "You can:",
    "  keep     Stop; forge/tr2 stays",
    "  discard  Stop; forge/tr2 is removed",
    "Not available:",
    "  merge  Merge into feat/0022-agentbay5",
    "         why: 1 must item is inconclusive.",
    "checked: 0 ran, 2 computed, 0 judged",
    `hash ${hash.slice(0, 12)}`,
    `decide with: bay approve <run> card --choice <name> --hash ${hash}`,
  ].join("\n");
}

async function recorded(stopped: Stopped): Promise<Json | undefined> {
  const shown = await bay(["runs", stopped.runId, "--events", "--project", stopped.project.root, "--json"]);
  const events = listOf(fieldOf(fieldOf(toJson(shown.json), "run") ?? null, "events"));
  const found = events.find((event) => textField(event, "kind") === "approval.recorded");
  return found === undefined ? undefined : fieldOf(found, "detail");
}

function outputOf(ran: Ran): Json | undefined {
  return fieldOf(fieldOf(toJson(ran.json), "run") ?? null, "output");
}

test("call, runs and resume print the card a run waits on, with a stable hash", async () => {
  await withStopped({ merge: true }, async (stopped) => {
    assert.equal(stopped.hash, offeredHash);
    const called = await bay(callArgv(stopped.project, true));
    assert.equal(called.exitCode, 0, called.output);
    const calledId = /^run (\S+) /.exec(called.output)?.[1] ?? "";
    assert.equal(called.output.replaceAll(calledId, "<run>"), offeredCard(offeredHash));
    const shown = await bay(["runs", stopped.runId, "--project", stopped.project.root]);
    assert.equal(withId(shown.output, stopped), `${offeredCard(offeredHash)}\n${stepsListed}`);
    const resumed = await bay(["resume", stopped.runId, "--project", stopped.project.root]);
    assert.equal(withId(resumed.output, stopped), offeredCard(offeredHash));
  });
});

test("a withheld choice is printed under Not available, with the reason the script gave", async () => {
  await withStopped({ merge: false }, async (stopped) => {
    assert.equal(stopped.hash, withheldHash);
    const shown = await bay(["runs", stopped.runId, "--project", stopped.project.root]);
    assert.equal(withId(shown.output, stopped), `${withheldCard(withheldHash)}\n${stepsListed}`);
  });
});

test("approve that changes nothing prints the card before its sentence, and asks the owner over the card", async () => {
  await withStopped({ merge: false }, async (stopped) => {
    const argv = approveArgv(stopped, "--choice", "keep", "--hash", stopped.hash);
    const piped = await bay(argv, { terminal: fakeTerminal({ interactive: false }) });
    assert.equal(piped.exitCode, 1);
    assert.equal(
      withId(piped.output, stopped),
      `${withheldCard(withheldHash)}\n\n` +
        "bay approve needs an interactive terminal (stdin is not a TTY). Approvals are for the owner, not for " +
        "agents: run it yourself in a terminal, or, if the project config lists chat under approvals.from, use " +
        "--via chat --quote.",
    );
    const declined = fakeTerminal({ interactive: true, answer: "no" });
    const notConfirmed = await bay(argv, { terminal: declined });
    assert.equal(notConfirmed.exitCode, 1);
    assert.equal(notConfirmed.output, "Not confirmed; nothing changed.");
    assert.deepEqual(declined.asked, [
      `${withheldCard(withheldHash).split("\n").slice(1, -1).join("\n")}\n` + "You choose keep. Type yes to confirm: ",
    ]);
    assert.equal(await recorded(stopped), undefined);
  });
});

test("what a script handed over beside a card is printed by none of call, runs, resume and approve", async () => {
  await withStopped({ merge: false, options: { approvalsFrom: ["terminal"] } }, async (stopped) => {
    const { project } = stopped;
    const terminal = fakeTerminal({ interactive: true, answer: "no" });
    const outputs = [
      (await bay(callArgv(project, false))).output,
      (await bay(["runs", stopped.runId, "--project", project.root])).output,
      (await bay(["resume", stopped.runId, "--project", project.root])).output,
      (await bay(approveArgv(stopped, "--choice", "keep", "--hash", stopped.hash))).output,
      (await bay(approveArgv(stopped, "--choice", "keep", "--hash", stopped.hash), { terminal })).output,
      ...terminal.asked,
      (
        await bay(
          approveArgv(stopped, "--choice", "keep", "--hash", "0".repeat(64), "--via", "chat", "--quote", "keep"),
        )
      ).output,
      (
        await bay(approveArgv(stopped, "--hash", stopped.hash), {
          terminal: fakeTerminal({ interactive: true, answer: "yes" }),
        })
      ).output,
    ];
    for (const output of outputs) {
      assert.ok(
        output.includes("Merge TR2 into feat/0022-agentbay5?") || output === "Not confirmed; nothing changed.",
        output,
      );
      assert.ok(!output.includes(rawOnly), output);
    }
    const json = await bay(["runs", stopped.runId, "--project", project.root, "--json"]);
    assert.ok(json.output.includes(rawOnly));
  });
});

const yes = { terminal: fakeTerminal({ interactive: true, answer: "yes" }) };

test("each offered choice is taken at a terminal with the owner's yes, and a later step reads it", async () => {
  for (const choice of ["merge", "keep", "discard"]) {
    await withStopped({ merge: true }, async (stopped) => {
      const approved = await bay(approveArgv(stopped, "--choice", choice, "--hash", stopped.hash), yes);
      assert.equal(approved.exitCode, 0, approved.output);
      assert.equal(
        withId(approved.output, stopped),
        `run <run> (workflow merger:workflows/merge.yaml): done\noutput:\n{\n  "taken": "${choice}"\n}`,
      );
      assert.deepEqual(await recorded(stopped), {
        stepKey: "card",
        hash: offeredHash,
        decision: "choice",
        choice,
        by: "owner at the terminal",
      });
    });
  }
});

test("a withheld choice and an unknown one are refused with the kernel's sentence, and nothing changes", async () => {
  await withStopped({ merge: false }, async (stopped) => {
    const withheld = await bay(approveArgv(stopped, "--choice", "merge", "--hash", stopped.hash), yes);
    assert.equal(withheld.exitCode, 1);
    assert.equal(
      withId(withheld.output, stopped),
      `${withheldCard(withheldHash)}\n\n.agentbay/kernel.db: The choice merge of step card is withheld: 1 must item is inconclusive.`,
    );
    const unknown = await bay(approveArgv(stopped, "--choice", "ship", "--hash", stopped.hash), yes);
    assert.equal(unknown.exitCode, 1);
    assert.equal(
      withId(unknown.output, stopped),
      `${withheldCard(withheldHash)}\n\n.agentbay/kernel.db: Step card has no choice ship; the choices offered are keep and discard.`,
    );
    assert.equal(await recorded(stopped), undefined);
  });
});

test("--choice with --reject, --choice where there are no choices, and none where there are each have a sentence", async () => {
  await withStopped({ merge: true }, async (stopped) => {
    const both = await bay(approveArgv(stopped, "--choice", "keep", "--reject", "--hash", stopped.hash), yes);
    assert.equal(both.exitCode, 2);
    assert.match(
      both.output,
      /^--choice and --reject do not go together: an approval with choices is answered by naming one, and one without choices by approving or rejecting\.\n/,
    );
    const none = await bay(approveArgv(stopped, "--hash", stopped.hash), yes);
    assert.equal(none.exitCode, 1);
    assert.equal(
      withId(none.output, stopped),
      `${offeredCard(offeredHash)}\n\n.agentbay/kernel.db: Step card offers choices, so a decision names one of them: merge, keep or discard.`,
    );
    assert.equal(await recorded(stopped), undefined);
  });
  const project = await makeProject();
  try {
    const call = ["call", "--workflow", "writer:workflows/review.yaml", '{"name":"Cy"}', "--project", project.root];
    const run = fieldOf(toJson((await bay([...call, "--json"])).json), "run") ?? null;
    const hash = textField(fieldOf(run, "waiting") ?? null, "hash") ?? "";
    const argv = ["approve", textField(run, "id") ?? "", "keep", "--choice", "keep", "--hash", hash];
    const plain = await bay([...argv, "--project", project.root], yes);
    assert.equal(plain.exitCode, 1);
    assert.equal(
      plain.output,
      ".agentbay/kernel.db: Step keep offers no choices, so a decision approves or rejects what it shows.",
    );
  } finally {
    await project.remove();
  }
});

test("a decision on a stale hash is refused beside the card as it is now", async () => {
  await withStopped({ merge: false }, async (stopped) => {
    const stale = "0".repeat(64);
    const refused = await bay(approveArgv(stopped, "--choice", "keep", "--hash", stale), yes);
    assert.equal(refused.exitCode, 1);
    assert.equal(
      withId(refused.output, stopped),
      `${withheldCard(withheldHash)}\n\n.agentbay/kernel.db: The hash ${stale} is not the hash of what step card showed (${withheldHash}).\n` +
        "  fix: Take one of the choices the waiting approval offers, naming the hash it shows.",
    );
    assert.equal(await recorded(stopped), undefined);
  });
});

test("a choice from chat is refused while approvals.from lacks chat, and recorded with the owner's words when it lists it", async () => {
  await withStopped({ merge: true }, async (stopped) => {
    const argv = approveArgv(stopped, "--choice", "keep", "--hash", stopped.hash, "--via", "chat", "--quote", "keep");
    const off = await bay(argv, yes);
    assert.equal(off.exitCode, 1);
    assert.equal(
      withId(off.output, stopped),
      `${offeredCard(offeredHash)}\n\n` +
        "Approvals from chat are off: approvals.from in agentbay.config.yaml lists terminal.\n" +
        "  fix: Approve from terminal; only the owner changes approvals.from.",
    );
    assert.equal(await recorded(stopped), undefined);
  });
  await withStopped({ merge: true, options: { approvalsFrom: ["chat"] } }, async (stopped) => {
    const quote = "Keep it; forge/tr2 stays.";
    const argv = approveArgv(stopped, "--choice", "keep", "--hash", stopped.hash, "--via", "chat", "--quote", quote);
    const taken = await bay([...argv, "--json"]);
    assert.equal(taken.exitCode, 0, taken.output);
    assert.deepEqual(outputOf(taken), { taken: "keep" });
    assert.deepEqual(await recorded(stopped), {
      stepKey: "card",
      hash: offeredHash,
      decision: "choice",
      choice: "keep",
      by: 'owner via chat, quoted: "Keep it; forge/tr2 stays."',
    });
  });
});

test("--json gives the card, the choices and the hash as the runs entry returns them, also beside a refusal", async () => {
  await withStopped({ merge: false }, async (stopped) => {
    const card = {
      title: "Merge TR2 into feat/0022-agentbay5?",
      lines: [
        { mark: "computed", words: "in scope: 11 of 11 paths", source: { step: "offer" } },
        { mark: "computed", words: "checks: 5 of 5 passed", source: { step: "offer" } },
      ],
      counted: { ran: 0, computed: 2, judged: 0 },
    };
    const waiting = {
      reason: "approval",
      stepKey: "card",
      question: "Merge this slice?",
      hash: withheldHash,
      content: {
        title: card.title,
        lines: card.lines,
        withheld: { merge: "1 must item is inconclusive." },
      },
      choices: [
        {
          name: "merge",
          status: "withheld",
          does: "Merge into feat/0022-agentbay5",
          reason: "1 must item is inconclusive.",
        },
        { name: "keep", status: "offered", does: "Stop; forge/tr2 stays" },
        { name: "discard", status: "offered", does: "Stop; forge/tr2 is removed" },
      ],
      card,
    };
    const shown = await bay(["runs", stopped.runId, "--project", stopped.project.root, "--json"]);
    assert.deepEqual(fieldOf(fieldOf(toJson(shown.json), "run") ?? null, "waiting"), waiting);
    const refused = await bay([...approveArgv(stopped, "--choice", "merge", "--hash", stopped.hash), "--json"]);
    assert.equal(refused.exitCode, 1);
    assert.deepEqual(fieldOf(fieldOf(toJson(refused.json), "run") ?? null, "waiting"), waiting);
    assert.deepEqual(fieldOf(toJson(refused.json), "problems"), [
      {
        file: "",
        path: "",
        message:
          "bay approve needs an interactive terminal (stdin is not a TTY). Approvals are for the owner, " +
          "not for agents: run it yourself in a terminal, or, if the project config lists chat under " +
          "approvals.from, use --via chat --quote.",
      },
    ]);
  });
});

test("a workflow whose choice does not say what it does is refused when it loads", async () => {
  const project = await mergerProject();
  try {
    const steps = mergeWorkflow.steps.map((step) =>
      "choices" in step ? { ...step, choices: { ...step.choices, keep: {} } } : step,
    );
    await project.write("components/modes/merger/workflows/merge.yaml", stringify({ ...mergeWorkflow, steps }));
    const called = await bay(callArgv(project, true));
    assert.equal(called.exitCode, 1);
    assert.equal(
      called.output,
      "components/modes/merger/workflows/merge.yaml:14: steps.1.choices.keep is missing the required field does.\n" +
        "  fix: Add does. Expected: What taking the choice does, in one sentence the owner reads beside its name " +
        "on the card.",
    );
  } finally {
    await project.remove();
  }
});
