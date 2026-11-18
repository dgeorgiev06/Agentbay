---
name: draft
description: Writes a short note that greets the person named in the input.
metadata:
  output: schemas/draft-output.json
---

## Input

A name and a greeting, as schemas/compose-input.json plus the greeting.

## Output

One note, as schemas/draft-output.json.

## Definition of done

- [DOD-1] (must) The note is at least twenty characters long; scripts/long-enough.ts checks it.

## Instructions

1. Read the earlier notes with db_query.
2. Write a note that uses the greeting and the name.

## Tools

- db
- files
- greeting-source.fetch
- compose

## Resources

- out/notes/

## Rules and constraints

- Never write outside out/notes/.
