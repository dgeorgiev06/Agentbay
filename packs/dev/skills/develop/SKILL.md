---
name: develop
description: Plan and build software in reviewed slices. USE WHEN the user wants to plan or build a feature or product from requirements, slice by slice, with hidden tests and review.
input:  { requirements: path, repo?: path } | { plan: path, parallel?: number }
output: { slices: array }
done:   The user has approved a plan, and every slice is reported as pass or needs-decision with its findings.
rules:
  - Plan and build are two workflow runs; the user approves the plan in chat before the build starts.
  - Never start the build, or merge, without the user's explicit approval.
  - Name every slice by its id and its short title.
---

The work runs as two saved workflows. Workflows cannot ask the user anything mid-run, so the approvals happen in chat between them.

**1. Plan.** Run the `dev:plan` workflow (the Workflow tool with `name: "dev:plan"`, or `/dev:plan`) with args `{requirements: string, repo?: string}`.
Example args: `{"requirements": "docs/wordcount.md", "repo": "."}`
It writes the plan to `<repo>/.agentbay/dev/plan.json` and returns `{plan, slices, interfaces, open_questions}`, where each slice line reads `S1: <title>`.

**2. Approve the plan.** Show the user, plainly:
- What it is: the plan file path and one line per slice, `S1 Count words in a file: depends on nothing`.
- What was checked: the lead read the requirements and the repo; nothing is built yet.
- What is not decided: each open question, with what each answer would change.
- What each reply does: "approve" starts the build; "change S2 ..." means you edit the plan file and show it again; "stop" ends here.
Wait for the reply. Do not start the build on silence or on your own reading.

**3. Build.** Run the `dev:build` workflow (`name: "dev:build"`, or `/dev:build`) with args `{plan: string, parallel?: number}`; `parallel` defaults to 2.
Example args: `{"plan": ".agentbay/dev/plan.json"}`
Per slice it writes hidden tests, has a builder implement the slice without seeing them, runs them, and has a reviewer check the diff against the merge rules. A slice gets at most two rounds. It returns `{slices: [{id, title, status, rounds, reason, failures, must, should}]}` with status `pass` or `needs-decision`.

**4. Approve the merge.** Show the user, plainly:
- What it is: one line per slice, `S1 Count words in a file: pass in 1 round`.
- What was checked: hidden tests passed and the reviewer found no blocking issue, for each passing slice.
- What is not decided: each needs-decision slice with its reason, its failing tests or must findings, and every should finding by its id and one-line text.
- What each reply does: "merge" means you commit the passing slices; "retry S3" runs `dev:build` again; "drop S3" reverts that slice's files.

The changes stay uncommitted in the working tree until the user approves the merge.
On `{"error": ...}` from either workflow, tell the user in one sentence.
