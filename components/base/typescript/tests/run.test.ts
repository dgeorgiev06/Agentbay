import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ModeProject } from "../../../../tests/test-toolbox.ts";
import {
  commandsRun,
  failingWith,
  hanging,
  openToolchainProject,
  packageWith,
  printing,
  withoutSeconds,
  writeCheckout,
  type Fields,
  type Files,
} from "./checkouts.ts";

let project: ModeProject;

before(async () => {
  project = await openToolchainProject();
});

after(async () => {
  await project.close();
});

const echoWords = 'node -e "for (const word of process.argv.slice(1)) console.log(word)" --';

const scripts = { demo: printing("a demo line"), words: echoWords, fails: failingWith("it failed", 3), hangs: hanging };

async function ranIn(
  name: string,
  files: Files,
  input: Fields,
): Promise<{ readonly commands: unknown; readonly answer: Fields }> {
  const folder = await writeCheckout(project, name, files);
  const ran = await project.run("typescript.run", { folder, timeLimitSeconds: 60, ...input });
  assert.ok(ran.state.status === "done", JSON.stringify(ran.state));
  return { commands: commandsRun(ran.events), answer: withoutSeconds(ran.state.output) };
}

test("run reads package.json, then runs npm run --silent -- with the script's name and the words, and answers all the script printed", async () => {
  const ran = await ranIn(
    "words",
    { "package.json": packageWith(scripts) },
    {
      name: "words",
      arguments: ["one", "two words"],
    },
  );
  assert.deepEqual(ran, {
    commands: [
      ["cat", "--", "package.json"],
      ["npm", "run", "--silent", "--", "words", "one", "two words"],
    ],
    answer: { ended: "exited", exitCode: 0, stdout: "one\ntwo words\n", stdoutCut: false },
  });
});

test("run answers a script's own exit code and what it printed before it", async () => {
  const ran = await ranIn("fails", { "package.json": packageWith(scripts) }, { name: "fails" });
  assert.deepEqual(ran.answer, { ended: "exited", exitCode: 3, stdout: "it failed\n", stdoutCut: false });
});

test("run says in a sentence that a script stopped at its limit did not finish", async () => {
  const ran = await ranIn("hangs", { "package.json": packageWith(scripts) }, { name: "hangs", timeLimitSeconds: 2 });
  assert.deepEqual(ran.answer, {
    ended: "timed-out",
    reason: "The script hangs did not finish within 2 seconds and was stopped.",
    stdout: "",
    stdoutCut: false,
  });
});

test("a script the checkout lacks, a checkout with no package.json and one whose package.json is not JSON are not set up, each with its sentence, and npm is not run", async () => {
  const lacking = await ranIn("lacks-demo", { "package.json": packageWith({ words: echoWords }) }, { name: "demo" });
  const absent = await ranIn("no-package", { "README.md": "no package\n" }, { name: "demo" });
  const notJson = await ranIn("not-json", { "package.json": "{ not json\n" }, { name: "demo" });
  const onlyRead = [["cat", "--", "package.json"]];
  assert.deepEqual(
    [lacking, absent, notJson],
    [
      {
        commands: onlyRead,
        answer: {
          ended: "not set up",
          reason: "The checkout's package.json has no script demo: add it to its scripts, or name a script it has.",
        },
      },
      { commands: onlyRead, answer: { ended: "not set up", reason: "The checkout has no package.json." } },
      {
        commands: onlyRead,
        answer: {
          ended: "not set up",
          reason: "The checkout's package.json is not JSON, so the mode cannot tell whether it has the script demo.",
        },
      },
    ],
  );
});
