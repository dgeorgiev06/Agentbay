import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";
import { fieldsOf, type Json } from "../../../../bay/sdk.ts";
import { openModeProject, type ModeProject } from "../../../../tests/test-toolbox.ts";

type Files = Readonly<Record<string, string>>;

let project: ModeProject;

const config = {
  adapter: "claude-code",
  modes: ["proof", "git-worktrees", "typescript"],
  bindings: { toolchain: "typescript", worktrees: "git-worktrees" },
  settings: { proof: { sameOutput: [{ name: "demo-output", run: "demo" }] } },
} as const;

function git(...parameters: readonly string[]): string {
  const identity = ["-c", "user.name=Proof Test", "-c", "user.email=proof-test@agentbay.invalid"];
  return execFileSync("git", [...identity, ...parameters], { cwd: project.root, encoding: "utf8" });
}

async function written(files: Files): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(project.root, path)), { recursive: true });
    await writeFile(join(project.root, path), text, "utf8");
  }
}

async function committed(files: Files): Promise<string> {
  await written(files);
  git("add", "--all");
  git("commit", "--quiet", "--message", "A commit of a project that is not the kit");
  return git("rev-parse", "HEAD").trim();
}

function packageWith(demoLine: string): string {
  const scripts = {
    demo: `node -e "console.log('${demoLine}')"`,
    words: 'node -e "for (const word of process.argv.slice(1)) console.log(word)" --',
  };
  return `${JSON.stringify({ name: "not-the-kit", private: true, scripts }, null, 2)}\n`;
}

function item(id: string, proof: Json): Json {
  return { id, says: `The item ${id} holds.`, level: "must", proof };
}

function sliceOf(base: string, head: string): Json {
  return {
    slice: {
      name: "DEMO",
      kind: "mode",
      scope: ["**"],
      after: [],
      done: [
        item("demo", { kind: "real-thing", runs: [{ run: "demo", stdout: "a louder demo line\n", exitCode: 0 }] }),
        item("words", {
          kind: "real-thing",
          runs: [
            { run: "demo", stdout: "a louder demo line\n", exitCode: 0 },
            { run: "words", arguments: ["two words", "$(no shell)"], stdout: "two words\n$(no shell)\n", exitCode: 0 },
          ],
        }),
        item("old-text", { kind: "real-thing", runs: [{ run: "demo", stdout: "a demo line\n", exitCode: 0 }] }),
        item("absent", { kind: "real-thing", runs: [{ run: "absent", stdout: "", exitCode: 0 }] }),
        item("output", { kind: "same-output", differ: ["demo-output"] }),
      ],
    },
    base,
    head,
    declared: { files: ["package.json"], names: { gained: [], lost: [], changed: [] } },
    bugs: [],
  };
}

function ownVerdicts(output: Json): Json {
  const verdicts = fieldsOf(output).verdicts;
  return Array.isArray(verdicts) ? verdicts.slice(0, 5) : null;
}

before(async () => {
  const given = await realpath(await mkdtemp(join(tmpdir(), "agentbay-proof-project-commands-")));
  try {
    await mkdir(join(given, "components"), { recursive: true });
    await writeFile(join(given, "agentbay.config.yaml"), "adapter: claude-code\nbindings: {}\n", "utf8");
    project = await openModeProject(config, { project: given });
  } finally {
    await rm(given, { recursive: true, force: true });
  }
});

after(async () => {
  await project.close();
});

test("in a project that is not the kit and has no bay.sh, a real-thing run that names a package.json script passes when the script prints the expected text, and same-output compares a script at the base and the head", async () => {
  const ignored = [".agentbay/", ".forge/", "node_modules", "components/", "agentbay.config.yaml"];
  const base = await committed({ ".gitignore": `${ignored.join("\n")}\n`, "package.json": packageWith("a demo line") });
  const head = await committed({ "package.json": packageWith("a louder demo line") });
  await written({ "package.json": packageWith("the project's own folder") });
  assert.equal(existsSync(join(project.root, "bay.sh")), false);
  assert.deepEqual(ownVerdicts(await project.output("proof.prove", sliceOf(base, head))), [
    {
      item: "demo",
      kind: "real-thing",
      verdict: "passed",
      detail: "Every run printed the expected text and ended with the expected exit code: 1 of 1.",
    },
    {
      item: "words",
      kind: "real-thing",
      verdict: "passed",
      detail: "Every run printed the expected text and ended with the expected exit code: 2 of 2.",
    },
    {
      item: "old-text",
      kind: "real-thing",
      verdict: "failed",
      detail: "Run 1 of 1 printed other than the item expects.",
    },
    {
      item: "absent",
      kind: "real-thing",
      verdict: "inconclusive",
      reason:
        "Run 1 of 1 is not known. The toolchain is not set up for it: " +
        "The checkout's package.json has no script absent: add it to its scripts, or name a script it has.",
    },
    {
      item: "output",
      kind: "same-output",
      verdict: "passed",
      detail: "Every declared command printed as the item says: 1 of 1, and 1 of them differs as named.",
    },
  ]);
  assert.deepEqual(await readdir(join(project.root, ".forge", "copies")), []);
});
