import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { stringify } from "yaml";
import type { Json } from "../bay/contracts.ts";
import { fieldOf, numberField, parseJson } from "../bay/json.ts";
import { testEnvironment } from "./kernel-fixture.ts";
import { kit, makeProject, type Project } from "./project-fixture.ts";

const anything = `${JSON.stringify({ type: "object" })}\n`;

const overreachingScript = [
  'import { defineScript } from "agentbay/sdk";',
  "",
  "export const run = defineScript(async (input, context) => {",
  '  const written = await context.files.write("out/probe/x.txt", "written by a read-only action");',
  "  const spent = await context.spend({ usd: 5 });",
  "  const posted = await context.http.request({",
  '    method: "POST",',
  '    url: "https://api.example.com/collect",',
  "    headers: {},",
  '    body: "{}",',
  "  });",
  "  return {",
  '    written: written.ok ? "written" : written.message,',
  '    spent: spent.ok ? "spent" : spent.message,',
  '    posted: posted.ok ? "posted" : posted.message,',
  "  };",
  "});",
  "",
].join("\n");

async function addOverreachingMode(project: Project): Promise<string> {
  const mode = {
    name: "prober",
    version: "1.0.0",
    description: "Declares only read and tries to write, spend and post.",
    resources: { files: { write: ["out/probe/"] }, network: ["api.example.com"] },
    actions: {
      probe: {
        input: "schemas/anything.json",
        output: "schemas/anything.json",
        effects: ["read"],
        run: [{ script: "scripts/probe.ts" }],
      },
    },
  };
  await project.write("components/modes/prober/mode.yaml", stringify(mode));
  await project.write("components/modes/prober/schemas/anything.json", anything);
  await project.write("components/modes/prober/scripts/probe.ts", overreachingScript);
  return join(project.root, "components", "modes", "prober", "mode.yaml");
}

function calledJson(project: Project, argv: readonly string[]): Json {
  const result = spawnSync(process.execPath, [join(kit, "bay", "cli.ts"), ...argv, "--json"], {
    cwd: project.root,
    env: testEnvironment,
    input: "",
    encoding: "utf8",
  });
  return parseJson(result.stdout);
}

test("a read-only action that writes a file, records a spend and posts is refused three times", async () => {
  const project = await makeProject();
  try {
    const manifest = await addOverreachingMode(project);
    const run = fieldOf(calledJson(project, ["call", "prober.probe", "{}"]), "run") ?? null;
    const output = fieldOf(run, "output") ?? null;
    const declared = "but the action probe declares the effects: read.";
    assert.deepEqual(output, {
      written:
        `The step 0 of action probe asked to write out/probe/x.txt, ${declared} ` +
        `Writing a file needs the write effect; to allow it, add write to actions.probe.effects in ${manifest}.`,
      spent:
        `The step 0 of action probe asked to report spending {"items":0,"usd":5,"tokens":0}, ${declared} ` +
        `Spending more than nothing needs the spend effect; to allow it, add spend to actions.probe.effects in ` +
        `${manifest}.`,
      posted:
        `The step 0 of action probe asked to send a POST request to https://api.example.com/collect, ${declared} ` +
        `A request over the network needs the network effect; to allow it, add network to actions.probe.effects ` +
        `in ${manifest}.`,
    });
    assert.equal(existsSync(join(project.root, "out", "probe", "x.txt")), false);
    assert.equal(numberField(fieldOf(run, "spent") ?? null, "usd"), 0);
  } finally {
    await project.remove();
  }
});
