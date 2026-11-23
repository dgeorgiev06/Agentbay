---
name: memory
description: Keep durable facts about the user, their work or preferences across sessions. USE WHEN the user asks you to remember a fact about themselves, asks what you know about them, or says forget that.
input:  { action: remember | recall | forget, fact?: string, topic?: string, query?: string, id?: string }
output: { id: string, fact: string, topic: string | null } | { facts: array } | { id: string, forgotten: true } | { error: string }
done:   The fact is stored, listed or removed, and the user is told which.
rules:
  - Facts are trimmed and blank facts are refused.
  - Topics are lowercased; recall returns the 50 newest facts first.
  - Save only what the user states; never infer or invent a fact.
allowed-tools: Bash(cos *)
---

Run these through Bash. Each prints one JSON object.

- Remember: `cos remember '{"fact": string, "topic"?: string}'`
  Example: `cos remember '{"fact":"Rents an apartment, does not own","topic":"home"}'`
- Recall: `cos recall '{"topic"?: string, "query"?: string}'`; the query matches text inside a fact, ignoring case.
  Example: `cos recall '{"query":"staking"}'`
- Forget: `cos forget '{"id": string}'`
  Example: `cos forget '{"id":"3f9a1c2e"}'`

Find an id with `cos recall` first and never guess it. If the output is `{"error": ...}`, relay that sentence plainly.
