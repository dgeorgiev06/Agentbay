import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { askedFiles, notRemade, recaptured, recapturedIn, withCapture, type Source } from "./recapture.ts";

const given = ["given-b1-card.json", "given-r7-failed.json", "given-p2-stopped.json", "given-wave-ca-cb.json"];

const source: Source = {
  file: "given-x.json",
  test: "x.test.ts",
  name: "a case that reaches its card",
  anchor: 'const card = waitingOf(run, "card");',
  run: "run.id",
  capture: { before: "draw" },
};

const text = [
  'test("another case", async () => {',
  '  const card = waitingOf(run, "card");',
  "});",
  'test("a case that reaches its card", async () => {',
  '  const card = waitingOf(run, "card");',
  "});",
  "",
].join("\n");

test("recapture puts its capture just before the named case reads its card, and refuses a case it cannot find", () => {
  const lines = withCapture(text, source, "/out/given-x.json").split("\n");
  assert.deepEqual(lines.slice(0, 4), text.split("\n").slice(0, 4));
  assert.match(
    lines[4] ?? "",
    /^ {2}\(await import\("node:child_process"\)\)\.execFileSync\(process\.execPath, \[".*recapture\.ts", "--capture", root, run\.id, /,
  );
  assert.ok((lines[4] ?? "").includes(JSON.stringify(JSON.stringify({ before: "draw", into: "/out/given-x.json" }))));
  assert.equal(lines[5], '    const card = waitingOf(run, "card");');
  assert.throws(() => withCapture(text, { ...source, name: "a case not there" }, "/out/given-x.json"), {
    message: 'x.test.ts has no case "a case not there" that reads its card with: const card = waitingOf(run, "card");',
  });
});

test("recapture remakes every given file when none is named, the ones named otherwise, and refuses a name it has no case for", () => {
  assert.deepEqual(askedFiles([]), given);
  assert.deepEqual(askedFiles(["given-p2-stopped.json"]), ["given-p2-stopped.json"]);
  assert.throws(() => askedFiles(["given-p2-stopped.json", "given-nope.json"]), {
    message: `recapture makes only ${given.join(", ")}; it has no case for given-nope.json.`,
  });
});

test("recapture fails naming each file it was asked to remake and did not write", () => {
  assert.equal(notRemade(given, [...given].reverse()), undefined);
  assert.equal(
    notRemade(given, ["given-r7-failed.json", "given-wave-ca-cb.json"]),
    "recapture did not write given-b1-card.json, given-p2-stopped.json: its case was skipped or never reached the " +
      "capture, so the file is as it was.",
  );
  assert.match(notRemade(["given-r7-failed.json"], []) ?? "", /^recapture did not write given-r7-failed\.json: /);
});

test("recapture run with a file it has no case for exits 1 naming it, before it copies the kit", () => {
  const ran = spawnSync(process.execPath, [join(import.meta.dirname, "recapture.ts"), "given-nope.json"], {
    encoding: "utf8",
  });
  assert.equal(ran.status, 1, ran.stderr);
  assert.match(ran.stderr, /it has no case for given-nope\.json\./);
  assert.equal(ran.stdout, "");
});

const skippedCase = [
  'import { test } from "node:test";',
  'test.skip("a case that reaches its card", async () => {',
  "  const root = process.cwd();",
  '  const card = waitingOf(run, "card");',
  "});",
  "",
].join("\n");

async function withSkippedCase(work: (copy: string) => Promise<void>): Promise<void> {
  const copy = await realpath(await mkdtemp(join(tmpdir(), "agentbay-recapture-test-")));
  try {
    await mkdir(join(copy, "components/base/forge/tests"), { recursive: true });
    await writeFile(join(copy, "components/base/forge/tests", source.test), skippedCase, "utf8");
    await work(copy);
  } finally {
    await rm(copy, { recursive: true, force: true });
  }
}

test("a case that is skipped writes no capture, and recapture counts its file as not written", async () => {
  await withSkippedCase(async (copy) => {
    assert.deepEqual(await recaptured(copy, source), []);
  });
});

test("recapture fails naming the file whose case was skipped, and writes nothing", async () => {
  await withSkippedCase(async (copy) => {
    await assert.rejects(recapturedIn(copy, [source]), {
      message:
        "recapture did not write given-x.json: its case was skipped or never reached the capture, so the file is " +
        "as it was.",
    });
  });
  assert.equal(existsSync(join(import.meta.dirname, source.file)), false);
});
