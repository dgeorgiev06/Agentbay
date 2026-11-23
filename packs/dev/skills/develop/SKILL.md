---
name: develop
description: Plan and build software in reviewed slices. USE WHEN the user wants to plan or build a feature or product from requirements, slice by slice, with hidden tests and review.
input:  { requirements: path, repo?: path } | { plan: object, parallel?: number }
output: { plan: { repo, slices, interfaces }, open_questions: array } | { slices: array }
done:   The user has approved a plan, and every slice is reported as pass or needs-decision with its findings.
rules:
  - Plan and build are two workflow runs; the user approves the plan in chat before the build starts.
  - Never start the build, or merge, without the user's explicit approval.
  - Name every slice by its id and its short title.
---

The work runs as two saved workflows. Workflows cannot ask the user anything mid-run, so the approvals happen in chat between them.

**1. Plan.** Run the `dev:plan` workflow (the Workflow tool with `name: "dev:plan"`, or `/dev:plan`) with args `{requirements: string, repo?: string}`.
Example args: `{"requirements": "docs/wordcount.md", "repo": "."}`
It writes no file and returns `{plan: {repo, slices, interfaces}, open_questions}`; each slice has `id, title, done, files, depends_on`.

**2. Approve the plan.** Show the user, plainly:
- What it is: one line per slice, `S1 Count words in a file: depends on nothing`.
- What was checked: the lead read the requirements and the repo; nothing is built yet.
- What is not decided: each open question, with what each answer would change.
- What each reply does: "approve" starts the build; "change S2 ..." means you edit the plan file and show it again; "stop" ends here.
Once the plan is shown, write it to `<repo>/.agentbay/dev/plan.json`, pretty-printed; a requested change is an edit to that file.
Wait for the reply. Do not start the build on silence or on your own reading.

**3. Build.** Run the `dev:build` workflow (`name: "dev:build"`, or `/dev:build`) with args `{plan: object, parallel?: number}`: the parsed content of `plan.json`, and `parallel` as a positive whole number, default 2.
Example args: `{"plan": {"repo": ".", "slices": [], "interfaces": []}}` with the real slices filled in.
Per slice a test writer returns hidden tests, a runner agent runs them in a scratch folder outside the repo, a builder implements the slice without seeing them, and a reviewer checks the diff against the merge rules. A slice gets at most two rounds. It returns `{slices: [{id, title, status, rounds, reason, failures, must, should}]}` with status `pass` or `needs-decision`.

**4. Approve the merge.** Show the user, plainly:
- What it is: one line per slice, `S1 Count words in a file: pass in 1 round`.
- What was checked: hidden tests passed and the reviewer found no blocking issue, for each passing slice.
- What is not decided: each needs-decision slice with its reason, its failing tests or must findings, and every must and should finding with its slice and id, `S2 R1 <text>`.
- What each reply does: "merge" means you commit the passing slices, leaving `.agentbay/` out of the commit; "retry S3" runs `dev:build` again; "drop S3" reverts that slice's files.

The changes stay uncommitted in the working tree until the user approves the merge.
On `{"error": ...}` from either workflow, tell the user in one sentence.
