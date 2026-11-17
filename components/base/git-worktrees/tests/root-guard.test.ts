import assert from "node:assert/strict";
import { test } from "node:test";
import type { ScriptContext } from "../../../../bay/sdk.ts";
import { git } from "../scripts/lib/git.ts";

const unused = { ok: false, kind: "failed", message: "This test gives the script only commands." } as const;

function answeredUnused(): Promise<typeof unused> {
  return Promise.resolve(unused);
}

function recordingContext(ran: (readonly string[])[]): ScriptContext {
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
        ran.push(request.command);
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

const changingCommands: readonly { readonly named: string; readonly gitArguments: readonly string[] }[] = [
  { named: "restore", gitArguments: ["--work-tree=.", "restore", "--worktree", "--source", "main", "--", "."] },
  { named: "switch", gitArguments: ["switch", "--end-of-options", "forge/slice"] },
  { named: "merge", gitArguments: ["merge", "--no-ff", "--no-edit", "--end-of-options", "forge/slice"] },
  { named: "merge", gitArguments: ["merge", "--abort"] },
  { named: "add", gitArguments: ["add", "--all", "--"] },
  {
    named: "commit",
    gitArguments: ["commit", "--quiet", "--no-verify", "--no-gpg-sign", "--file=-", "--end-of-options"],
  },
  { named: "apply", gitArguments: ["--work-tree=.", "apply", "--end-of-options"] },
];

for (const { named, gitArguments } of changingCommands) {
  test(`git ${gitArguments.join(" ")} is refused in the project's own folder before it runs`, async () => {
    const ran: (readonly string[])[] = [];
    await assert.rejects(git(recordingContext(ran), ".", gitArguments), {
      message: `The mode runs git ${named} only in a folder under .forge/, not in ., so that the owner's checkout is never changed.`,
    });
    assert.deepEqual(ran, []);
  });
}

test("a command that changes files is refused in any folder outside .forge/, and runs in one under it", async () => {
  const ran: (readonly string[])[] = [];
  const context = recordingContext(ran);
  await assert.rejects(git(context, "src", ["switch", "--end-of-options", "forge/slice"]), {
    message:
      "The mode runs git switch only in a folder under .forge/, not in src, so that the owner's checkout is never changed.",
  });
  await assert.rejects(git(context, ".forge/../src", ["switch", "--end-of-options", "forge/slice"]), {
    message:
      "The mode runs git switch only in a folder under .forge/, not in .forge/../src, so that the owner's checkout " +
      "is never changed.",
  });
  await git(context, ".forge/worktrees/slice", ["switch", "--end-of-options", "forge/slice"]);
  await git(context, ".", ["status", "--porcelain=v1"]);
  assert.deepEqual(
    ran.map((command) => command.slice(8)),
    [
      ["switch", "--end-of-options", "forge/slice"],
      ["status", "--porcelain=v1"],
    ],
  );
});
