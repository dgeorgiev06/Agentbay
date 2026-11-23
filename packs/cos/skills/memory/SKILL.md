---
name: memory
description: Keep durable facts about the user across sessions. USE WHEN the user says remember this, asks what you know about something, or says forget that.
input:  { action: remember | recall | forget }
output: { id: string } | { facts: array } | { forgotten: true }
done:   The fact is stored, listed or removed, and the user is told which.
rules:
  - Facts are trimmed and blank facts are refused.
  - Topics are lowercased; recall returns the 50 newest facts first.
  - Save only what the user states; never infer or invent a fact.
---

Run these commands through Bash. Each prints one JSON object.

`cos remember '{"fact": string, "topic"?: string}'` stores one fact and returns `{"id","fact","topic"}`.
Example: `cos remember '{"fact":"Rents an apartment, does not own","topic":"home"}'`

`cos recall '{"topic"?: string, "query"?: string}'` returns `{"facts":[{"id","fact","topic","created"}]}`. The query matches text inside a fact, ignoring case.
Example: `cos recall '{"query":"staking"}'`

`cos forget '{"id": string}'` removes one fact and returns `{"id","forgotten":true}`.
Example: `cos forget '{"id":"3f9a1c2e"}'`
Find the id with `cos recall` first, and never guess it.

`cos schema` lists every action with its input and output.

On an error the command prints `{"error": ...}`; tell the user in one sentence.
