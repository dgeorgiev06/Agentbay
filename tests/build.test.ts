import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { test } from "node:test";
import { parse, stringify } from "yaml";
import { planAgents } from "../bay/build.ts";
import { skillNameOf, skillToolsOf } from "../bay/skill-tools.ts";
import { isRecord } from "../bay/json.ts";
import { streamTerminal } from "../bay/terminal.ts";
import { fakeFileSystem } from "./fakes.ts";
import { openKernel } from "./kernel-fixture.ts";
import { makeProject } from "./project-fixture.ts";

test("planAgents gives one agent per mode and skill, at the highest tier asked, with the union of effects", async () => {
  const project = await makeProject();
  const manifestFile = "components/modes/writer/mode.yaml";
  const manifest: unknown = parse(await project.read(manifestFile));
  assert.ok(isRecord(manifest) && isRecord(manifest.actions));
  const redraft = {
    description: "When the owner wants a note drafted again.",
    input: "schemas/compose-input.json",
    output: "schemas/draft-output.json",
    effects: ["read", "spend"],
    run: [{ skill: "skills/draft/", tier: "deep" }],
  };
  const actions = { ...manifest.actions, redraft };
  await project.write(manifestFile, stringify({ ...manifest, actions }));
  const kernel = await openKernel(project);
  const planned = await planAgents({
    system: kernel.system,
    files: kernel.ports.files,
  });
  assert.ok(planned.ok, planned.ok ? "" : JSON.stringify(planned.problems));
  assert.equal(planned.value.length, 1);
  const [agent] = planned.value;
  assert.ok(agent);
  assert.equal(agent.agent, "agentbay-writer-draft");
  assert.equal(agent.skill, "draft");
  assert.equal(agent.tier, "deep");
  assert.equal(agent.description, "Writes a short note that greets the person named in the input.");
  assert.deepEqual([...agent.effects].sort(), ["read", "spend", "write"]);
  assert.deepEqual(agent.grants.writePaths, [`${project.root}/out/notes`]);
  kernel.close();
  await project.remove();
});

test("planAgents reports a skill whose front matter cannot be read", async () => {
  const project = await makeProject();
  await project.write("components/modes/writer/skills/draft/SKILL.md", "no front matter\n");
  const kernel = await openKernel(project);
  const planned = await planAgents({
    system: kernel.system,
    files: kernel.ports.files,
  });
  assert.ok(!planned.ok);
  assert.match(planned.problems[0]?.message ?? "", /has no front matter/);
  kernel.close();
  await project.remove();
});

test("a skill's Tools section maps to kernel tools; secrets, http and events give none", async () => {
  const text = [
    "## Instructions",
    "- db",
    "## Tools",
    "",
    "1. `files`: to read the drafts",
    "- secrets",
    "- http,",
    "```",
    "- db",
    "```",
    "## Resources",
    "- db",
  ].join("\n");
  const files = fakeFileSystem({ "/s/a.md": text, "/s/b.md": "## Tools\n- items-store.get\n- db\n" });
  assert.deepEqual(await skillToolsOf(files, "/s/a.md"), {
    kernelTools: ["files_read", "files_list", "files_write", "submit"],
    actions: [],
  });
  assert.deepEqual(await skillToolsOf(files, "/s/b.md"), {
    kernelTools: ["db_query", "call_action", "submit"],
    actions: ["items-store.get"],
  });
  assert.deepEqual(await skillToolsOf(files, "/s/missing.md"), { kernelTools: ["submit"], actions: [] });
  assert.equal(skillNameOf("skills/draft/"), "draft");
});

test("the terminal reads a line and all of stdin", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  let shown = "";
  output.on("data", (chunk: Buffer) => {
    shown += chunk.toString();
  });
  const terminal = streamTerminal({ input, output });
  assert.equal(terminal.isInteractive(), false);
  const answer = terminal.ask("Type yes: ");
  input.write("yes\n");
  assert.equal(await answer, "yes");
  assert.equal(shown, "Type yes: ");
  const all = terminal.readAll();
  input.end('{"text":"x"}');
  assert.equal(await all, '{"text":"x"}');
});

test("planAgents plans agents only for the active modes, each pointing at its skill file by absolute path", async () => {
  const project = await makeProject();
  const kernel = await openKernel(project);
  const planning = { files: kernel.ports.files };
  const active = await planAgents({ ...planning, system: kernel.system });
  assert.ok(active.ok, active.ok ? "" : JSON.stringify(active.problems));
  assert.deepEqual(
    active.value.map((agent) => agent.skillFile),
    [`${project.root}/components/modes/writer/skills/draft/SKILL.md`],
  );
  const greeterOnly = new Map([...kernel.system.modes].filter(([name]) => name === "greeter"));
  const withoutWriter = { ...kernel.system, modes: greeterOnly, inactive: new Set(["writer"]) };
  const inactive = await planAgents({ ...planning, system: withoutWriter });
  assert.deepEqual(inactive, { ok: true, value: [] });
  kernel.close();
  await project.remove();
});
