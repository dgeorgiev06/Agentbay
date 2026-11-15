# 11. The same code lives in one place

Date: 2026-11-15. Status: accepted.

**Decision.** When the same code or the same rule exists in more than one place, builders and reviewers flag it and it is moved to one place.

- A builder's report has a section "the same thing in more than one place": every block or rule the slice touched, or added, that also exists elsewhere, and what was done about each.
- A reviewer runs the copy-paste detector on every slice and reads the result against the slice's files. A reviewer also looks for the same rule written twice in different words, which no tool finds.
- Where the one place is:
  - Inside one feature or one mode: a private file of that feature or mode.
  - Between kernel features: the feature that owns the idea exports it from its entry file. Only what every feature needs goes into the vocabulary.
  - Between modes: the toolbox (`bay/sdk.ts`), because mode code may import nothing else from the kit.
  - Between the kernel and a harness adapter: the kernel's harness interface (`bay/adapter.ts`).
- Two blocks that look alike but change for different reasons are not the same thing. They stay apart, and the report says why. Sharing them would tie two features together.
- The detector runs in `npm run check` with a threshold, once the findings below are cleared. Until then the count may only fall.

**Why.** Owner requirement. Agents copy what is near. A rule in two places is changed in one and forgotten in the other; slice R3a left the task-token rules in two places on purpose and that has to be the exception, with an end date.

**Cost.** A new development tool (`jscpd`), run with `npx`. Some slices grow because a second caller must move to the shared place.

**Found on the day this was written** (TypeScript, tests left out, blocks of four lines and 35 tokens or more): 21 blocks. The clearest:

- `scripts/lib/json.ts` is the same file in the store mode and the feed-briefing mode. It belongs in the toolbox.
- Reading a JSON record safely is written in `bay/json.ts`, `bay/protocol-json.ts` and the adapter's `guard-input.ts`.
- The last-resort error net is written in both `bay/cli.ts` and `bay/mcp.ts`.
- The broker repeats one guard shape four times, and shares two blocks with the script runner and script host.
- `bay/runs/workflow-steps.ts` repeats one block four times.
- `bay/build.ts` and `bay/policy.ts` share a block; so do `bay/targets.ts` and `bay/runs/waiting.ts`.

Tests have 16 blocks of six lines or more. Test set-up that is repeated goes into a fixture; assertions that read alike may stay.
