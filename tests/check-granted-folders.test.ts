import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { makeProject, type Project } from "./project-fixture.ts";

function ran(project: Project, words: readonly string[]): { readonly status: number | null; readonly output: string } {
  const result = spawnSync(process.execPath, [project.cli, ...words], {
    cwd: project.root,
    env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
    input: "",
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

const refusal = /the step agentbay-writer-draft is granted \S+\/out\/notes, which holds \S+\/out\/notes\/\.env/;

test("bay check reports, as an error, the granted folder that holds a secret file the build refuses", async () => {
  const project = await makeProject({ adapter: "claude-code" });
  try {
    await project.write("out/notes/.env", "TOKEN=1\n");
    const checked = ran(project, ["check"]);
    assert.match(checked.output, refusal);
    assert.match(checked.output, /bay check: 1 error/);
    const built = ran(project, ["build"]);
    assert.notEqual(built.status, 0);
    assert.match(built.output, refusal);
  } finally {
    await project.remove();
  }
});

test("bay check finds nothing to report and bay build passes once the granted folder holds no such file", async () => {
  const project = await makeProject({ adapter: "claude-code" });
  try {
    await project.write("out/notes/kept.md", "a note\n");
    assert.doesNotMatch(ran(project, ["check"]).output, /is granted/);
    assert.equal(ran(project, ["build"]).status, 0);
  } finally {
    await project.remove();
  }
});
