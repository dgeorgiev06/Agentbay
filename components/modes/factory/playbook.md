# factory (coordinator playbook)

The factory turns a requirements document into reviewed, integrated code, one stage at a time. You run the stages;
the dispatcher runs the steps inside each one. You never implement, review or decide anything yourself.

## The loop

1. Start a run: `.agentbay/bay call factory.start '{"goal": "<one line>", "requirements": "<path>"}'`.
2. Ask what to run now: `.agentbay/bay call factory.next '{"runId": "<F-id>"}'`.
3. Run **every** call in `calls`. Entries in one answer are independent: dispatch them at the same time, each as its
   own `bay call`, and drive each one's steps as usual. The `parallel` setting of the stage caps how many you get.
4. When every call of that batch has finished, ask again (step 2). Ask only then: `factory.next` reports what has
   been recorded, so asking while calls are still out hands you the same calls twice.
5. `status: stage-ready` means there is work; `waiting` names what an earlier stage still owes; `blocked` means the
   run needs the owner (read `reason` and `blockers` to them); `done` means every stage is complete and names the
   branch the work is on.

## What you tell the user

- After each batch: the stage, what each call covered, and how it ended.
- At the `approve` stage: the plan file's path, so they read it before passing the gate. The gate is theirs; relay
  it, never pass it.
- When a run ends: the integration branch, the slices on it, the findings that were fixed and anything still open.
  The factory does not merge into the user's own branches and does not remove the worktrees; say so.

## Rules

- Only the factory's own endpoints: `start`, `next`, `spec`, `plan`, `approve`, `slice`, `build`, `audit`, `fix`,
  `integrate`, `status`. Never run version-control commands of your own in a slice's worktree.
- Never re-dispatch a call that is already out, and never record a stage yourself: each endpoint records its own.
- A call that ends `partial` or `blocked` is recorded by its own stage; report it and ask again. The run decides
  whether that means a fix round, a re-review or the owner.
