# Word count CLI

A small Node.js command, `wc.ts`, run directly with `node wc.ts <file> [--top N]`. Built-ins only, no build step.

## Requirements

1. Counting. Given a UTF-8 text file, print the number of lines, words and characters, as JSON: `{"lines": 3, "words": 12, "chars": 64}`. A word is a run of letters, digits or apostrophes; case does not matter.
2. Top words. With `--top N`, also print the N most frequent words as `"top": [{"word": "the", "count": 4}, ...]`, ties broken alphabetically. N defaults to 10 and must be a positive integer.
3. Errors. A missing file, an unreadable file or a bad `--top` value prints `{"error": "<plain sentence>"}` and exits 1. Everything else exits 0.

## Notes

- Counting is a pure function of the text; only the entry point reads the file.
- Tests use `node:test` and run in under a second.
