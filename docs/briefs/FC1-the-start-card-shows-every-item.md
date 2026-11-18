# Brief FC1: the start card shows every item of the slice's definition of done

A mode slice (P-34), in `components/base/forge/` only. Words are used as `CONTEXT.md` defines them. Practices are cited by id from `framework/practices.md`.

The owner approved forge's first real start card with the words "make the card complete". The card names the slice, its kind, base, scope and order, and then only counts the items: "3 items: 2 name a kind of proof, 1 is judgement" and "judgement, by you: 3". He could not read what he was approving, and the second line reads as a count though 3 is an item's number.

## Output

1. The start card shows, after the scope and order, every item of the slice's definition of done, each as: its id, whether it is must or should, how it is held (the name of its kind of proof in plain words, such as "checks", "a test fails first", or "your judgement"), and its sentence `says`, whole, wrapped to the card's 44 columns. The two count lines go; a judgement item says so on its own line.
2. For a `fails-first` item the test files are named; for `count`, `same-output`, `real-thing` and `bugs-caught` the card says in one short line what will be run or counted, by number and name, never a patch's text.
3. If the bugs to inject are given, one line says how many and names each.
4. Every line stays `computed` and cites the step `slice`. The words come from the plan and the request only.
5. A card can be long; it is never cut. If one word is longer than a line, it is broken, not dropped.
6. `scripts/lib/cards.ts`, its tests, the example files, and the one-slice test's literal start card follow. The merge card is not changed.

## Definition of done

- [DOD-1] (must) Tests first, seen failing: the start card for TR2's slice and for a slice with one item of every kind, literally, line by line; every line at most 44 columns; an item's sentence appears whole when its lines are joined.
- [DOD-2] (must) Nothing but the plan's and the request's words reach the card; a sentence with a newline, a tab or a control character is shown with spaces in their place (pin it).
- [DOD-3] (must) The end-to-end case that reads the start card as printed passes with the new card.
- [DOD-4] (must) Bug injection, at least 6, in a throwaway copy that is a git repository: an item dropped; a should shown as must; a judgement item shown as proved by a kind; a sentence cut at the line's end; a line of 45 columns; the test files of a fails-first item not named.
- [DOD-5] (must) Only `components/base/forge/` changes. Run before you report, and paste: `npx tsc --noEmit -p .`, `npm run lint`, `npm run format:check`, `npm run deadcode`; every test file under `components/base/forge/tests/`; `tests/feature-map.test.ts`; `./bay.sh check`. No `npm run check`: the reviewer runs the whole suite on the merged branch.

## Rules and constraints

- P-01 no comments. P-04 readable before short. P-05. P-28: every line is read by the owner on a phone; show the card for the todo plan's slice TD1 (`docs/plans/0023-todo-mode.yaml`, first slice) in your report, as printed.
- Report (P-22), short sentences, under 40 lines: the TD1 card first; anything beyond the brief; each DOD item; the bug table.
