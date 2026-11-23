---
name: todo
description: Personal todo list. USE WHEN the user wants to add, capture or be reminded of a task ("remind me to...", "add a todo"), see their list ("what's on my list", "what's left"), or finish a task ("I finished t1", "mark it done", "complete").
input: { action: add | list | finish, text?: string, due?: date, status?: open | done | all, id?: string }
output: { id: string } | { todos: array } | { id: string, done: true } | { error: string }
done: The command ran and its JSON result was reported.
rules:
  - Text is trimmed; blank text is refused.
  - Due dates are YYYY-MM-DD; resolve words like "tomorrow" from today's date first.
  - Ids look like t1 and are returned by add and list.
---

Run these through Bash. Each prints one JSON object.

- Add: `todo add '{"text": string, "due"?: "YYYY-MM-DD"}'`
  Example: `todo add '{"text":"call the plumber","due":"2026-11-23"}'`
- List: `todo list '{"status"?: "open" | "done" | "all"}'` (default open)
  Example: `todo list '{"status":"all"}'`
- Finish: `todo finish '{"id": string}'`
  Example: `todo finish '{"id":"t1"}'`

After add, report the new id. If the user finishes something by description, list first to find its id. If the output is `{"error": ...}`, relay that sentence plainly.
