import assert from "node:assert/strict";
import { test } from "node:test";
import type { CommandRequest, ScriptContext } from "../../../../bay/sdk.ts";
import { git, type GitCall } from "../scripts/lib/git.ts";

const unused = { ok: false, kind: "failed", message: "This test gives the script only commands." } as const;

function answeredUnused(): Promise<typeof unused> {
  return Promise.resolve(unused);
}

function recordingContext(ran: CommandRequest[]): ScriptContext {
  return {
    db: { execute: answeredUnused, query: answeredUnused, partition: () => ({ ...partitionUnused }) },
    files: {
      read: answeredUnused,
      write: answeredUnused,
      list: answeredUnused,
      makeFolder: answeredUnused,
      link: answeredUnused,
      remove: answeredUnused,
    },
    secrets: { get: answeredUnused },
    http: { request: answeredUnused },
    events: { emit: answeredUnused },
    commands: {
      run: (request) => {
        ran.push(request);
        const output = { text: "", cut: false };
        const value = { end: { how: "exited", exitCode: 0 } as const, milliseconds: 0, stdout: output, stderr: output };
        return Promise.resolve({ ok: true, value } as const);
      },
    },
    call: answeredUnused,
    settings: {},
    now: () => new Date(0),
    spend: answeredUnused,
    caller: undefined,
    skillInput: undefined,
  };
}

const partitionUnused = {
  execute: answeredUnused,
  query: answeredUnused,
  migrate: answeredUnused,
  agentQuery: answeredUnused,
};

const changingCommands: readonly { readonly named: string; readonly call: GitCall }[] = [
  { named: "restore", call: ["restore-paths", "main", "--", "."] },
  { named: "switch", call: ["switch-branch", "forge/slice"] },
  { named: "merge", call: ["merge-branch", "forge/slice"] },
  { named: "merge", call: ["abort-merge"] },
  { named: "add", call: ["stage-everything"] },
  { named: "commit", call: ["commit-staged"] },
  { named: "apply", call: ["apply-patch"] },
];

for (const { named, call } of changingCommands) {
  test(`git ${call.join(" ")} is refused in the project's own folder before it runs`, async () => {
    const ran: CommandRequest[] = [];
    await assert.rejects(git(recordingContext(ran), ".", call), {
      message: `The mode runs git ${named} only in a folder under .forge/, not in ., so that the owner's checkout is never changed.`,
    });
    assert.deepEqual(ran, []);
  });
}

test("a command that changes files is refused in any folder outside .forge/, and runs in one under it", async () => {
  const ran: CommandRequest[] = [];
  const context = recordingContext(ran);
  await assert.rejects(git(context, "src", ["switch-branch", "forge/slice"]), {
    message:
      "The mode runs git switch only in a folder under .forge/, not in src, so that the owner's checkout is never changed.",
  });
  await assert.rejects(git(context, ".forge/../src", ["switch-branch", "forge/slice"]), {
    message:
      "The mode runs git switch only in a folder under .forge/, not in .forge/../src, so that the owner's checkout " +
      "is never changed.",
  });
  await git(context, ".forge/worktrees/slice", ["switch-branch", "forge/slice"]);
  await git(context, ".", ["changes"]);
  assert.deepEqual(
    ran.map((request) => [request.name, ...request.arguments]),
    [["switch-branch", "forge/slice"], ["changes"]],
  );
});
