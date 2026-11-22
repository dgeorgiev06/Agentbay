# One approval screen

Slice AS1. The owner, 21 November 2026: "I don't read the card because it is hard to read. Every thing needs to be
easy clear", "Should in one place", and later "When I ask for details should be very clear as well". He answered
"Better" to a layout of fixed sections, and, shown both views, "Rework for plain reading" for the details: group
each thing's facts together, say conditions and practices in words with the id after, say once per group that a
model wrote it.

Today an approval's card is laid out in many places: the kernel (`bay/approval-card.ts`, `bay/trust-card.ts`), each
forge script that writes its lines already wrapped (`draw.ts`, `draw-design.ts`, `draw-plan.ts`, `draw-wave.ts`),
and the pm mode. Each whole card is pinned in tests, so one changed word fails tests in files that have nothing to
do with it. This note says how one kernel module draws every approval from facts, and converts one screen: forge's
design card.

## The interface: a step hands facts, the kernel draws

A step hands the kernel facts as data, never laid-out lines, at the place a card is today (what the workflow's
`show` points at), so the approval's hash covers them with no change to hashing.

```
Screen  = { title, lines: Fact[], withheld?: { <choice>: <reason> } }
Fact    = { section, short?, about?, mark, words, source }
section = "problems" | "what" | "checks" | "open"       (in this order on both views)
short   = true: the fact belongs on the short screen; left out: details only (problems ignore it)
about   = what the fact is about ("rule add, in module todo"), 1 to 80 characters; facts in a row with the same
          about form one block in the details; the kernel uses it only to group
mark    = "computed" (a script worked it out) | "ran" (a tool ran it) | "judged" (a model wrote it)
words   = one line of text, 1 to 600 characters, not only spaces
source  = { step, command?, run?, item? }   (as a card line's source today)
title   = 1 to 200 characters of plain ASCII (letters, digits, spaces, punctuation)
```

- One list, `sections` in `bay/screen-words.ts`, gives the sections, their order, their headings, what `--section`
  takes, and what the kernel validates; the same file holds every row the kernel writes itself (`kernelWords`) and
  the bounds. Nothing else lists them.
- A card whose every line has a `section` is a screen; one where only some lines have one is refused. A card with
  no `section` is today's card, drawn as today, so both forms coexist while screens are converted.
- The kernel checks every fact's source as it checks a card line today (`bay/runs/card.ts`): `computed` cites a step
  that ran no skill, `judged` a skill step the approval quotes (the kernel adds the skill and tier), `ran` a command
  the kernel recorded.
- What each reply does is not a fact: the kernel takes each choice's `does` from the workflow and each withheld
  choice's reason from `withheld`, as today.
- Not in this slice: a long value (a schema, an example) as a block of its own.

`bay/approval-screen.ts` draws both views; its interface is `screenOf(approval)`, `screenLines(screen, runId)`,
`detailsLines(screen, record, section?)`, `sectionNamed(name)` and `sectionNames()`, all pure. `bay/approval-card.ts`
keeps drawing old cards and hands a screen to it, so `bay runs` and the terminal's `bay approve` show the short
screen.

## The short screen

- The title in capitals, then Problems, What it is, Checks, Not decided, What each reply does, the reply, and the
  command for the details. A section with nothing in it is left out.
- Problems come first and whole. The kernel itself prints each withheld choice there, from the hashed `withheld`:
  `You cannot reply approve now: <what it does>` and `Why: <reason>`, whatever the facts say, so a problem cannot
  hide in another section. Then every fact of the section, short or not, never cut.
- Other sections show at most 4 rows of their short facts; a fact is shown whole or not at all, and the facts left
  out are counted: `and 16 more, see details`.
- A model's facts are led by `A model wrote:` and indented under it; a tool's by `<command> reported:`; a script's
  are shown as they are.
- Rows are at most 44 columns, but commands, which are kept whole to be copied.

## The details

`bay runs <run> --details` prints every fact, in the same sections and order, nothing left out. It opens with how
many facts each section has and how to ask for one alone, `--details --section checks`, for a phone. Facts with the
same `about` form a block: the about as a row, then under it, once per source, who produced them ("A script worked
this out, in step draw:", "A model wrote this, in step designs (forge skills/design, tier deep):", "A tool ran
npm-test, in step prove:"), and the facts. Facts from different steps never share an author row. The last section,
`For the record`, holds the counts by who produced the facts, then the lines for copying: the steps, the full hash
and the command to decide. One full view plus `--section` was chosen over a middle level so that nothing is ever
left out of the details.

`--details` is never ignored without a word: an approval screen waiting beside another wait prints its details too
(and without `--details` prints as a screen, not as "also ..."); an old card, a run with no approval screen
waiting, and the list of runs each say in one sentence that there are no details in this form and what to run.

## What the hash covers

The hash of what `show` points at, as today: the title, every fact with its section, `short`, `about`, mark, words
and source, and the withheld reasons. Both views are pure functions of those checked facts, the choices and the
record. Not in the hash, as on today's cards: each choice's `does` (the workflow's text) and the skill and tier the
kernel adds (read from the run); hashing them is a later slice, since it changes every approval's hash.

## Security properties that must not weaken

1. Whole on request: every fact is in the details, whole; the short screen counts what it leaves out, per section,
   and never leaves out a problem or a withheld choice's reason.
2. No verdicts: the kernel writes only headings, who produced a fact, counts, choices and reasons. Facts say what
   was reported ("A review by a model: 0 findings; all 3 practices it judged are held."), never good, correct,
   safe, confined or no leak.
3. A model's words never read as a script's: a `judged` fact is under `A model wrote:` on the short screen and
   under `A model wrote this, ...` in the details; the kernel checks a `computed` fact cites no skill step.
4. No forged kernel rows. Rows at the left edge (headings, the title, `Reply:`, `Details:`, `For the record`) cannot
   be imitated, since facts are always indented. Rows the kernel writes inside a section cannot be either: the
   kernel refuses a fact or an about whose words begin with one of its own phrases (`and N more`, `A model wrote`,
   `A script worked this out`, `A tool ran`, `<command> reported:`, `You cannot reply`, `Why:`, `Reply:`,
   `Details:`, `For the record` and the rest of `kernelWords`, matched as whole words) or that is a heading.
   Control, bidi and zero-width characters (U+061C, U+200B to U+200F, U+2028, U+2029, U+202A to U+202E, U+2060,
   U+2066 to U+2069, U+FEFF) are shown as `\uXXXX`, so a fact cannot break onto a row of its own. A title is plain
   ASCII printed in capitals, so no row of it has the lowercase letters every kernel row has.
5. Choices not available keep their reasons, whole, at the top.
6. Chat approval is unchanged: the owner's quoted words and the full hash. At the terminal, the screen is followed
   by the hash's first 12 characters before "Type yes", as the old card had.

## Migration, one screen a slice

Each slice converts one screen: its script hands facts, its tests ask facts through `factsOf`, `offeredOf` and
`withheldOf` in forge's `tests/kit-copy.ts`, and whole-text pins are removed. The layout is pinned once, in
`tests/inside/command-line/approval-screen.test.ts`; the wording of a screen's facts once, as data (section, about,
mark, step, words), in its own mode test (for the design card, `design-card.test.ts`); the workflow's choices once,
in the workflow's test (`design.test.ts`). In AS1 the design card's text was pinned in 4 test files through a copy
of the kernel's layout (`tests/printed-card.ts`); after it, none.

1. AS1, this slice: the design card, without "Not decided".
2. AS2: the challenger's required "Not decided" list (the owner answered "Yes, required"), filling `open`.
3. AS3: forge's path card. 4. AS4: the wave's start and merge screens. 5. AS5: the plan card, and the start and
   merge cards of a slice built alone.
6. AS6: the wave cards, done in AS4. 7. AS7: the pm mode's cards. 8. AS8: the trust card.
9. Last: delete the old layout in `bay/approval-card.ts` and forge's `tests/printed-card.ts`.

Forge's `given` outputs are captured before the draw step, so no recapture is needed for a converted draw script.
A converted step before the capture, as the wave step whose start screen `given-wave-ca-cb.json` holds, is
recaptured with `components/base/forge/tests/recapture.ts`.

The coordinator's block says to show "every line it prints for the approval, unchanged and whole". Proposed once
every screen is converted (not changed here): "Show the owner the approval screen `bay runs <run>` prints, unchanged
and whole. When he asks for details, show what `bay runs <run> --details` prints, unchanged and whole."

## Open

1. Words from a document the owner approved (found in AS4, the wave's start and merge screens). A slice's title is
   the planner's words, so it may be neither a script's fact nor a `judged` one: `judged` cites a skill step of this
   run that the approval quotes, and the planner ran in the plan's run. Until this is decided, both wave screens
   leave the title and a planned item's words out and point to the plan file and slice. Proposal, not built:
   - a third kind of fact, "words from a document the owner approved", naming a committed file the run read and a field in it;
   - the kernel checks the words equal that field of the file at the commit the run started from;
   - it prints them under a row of its own, such as "From the plan you approved:", never as a script's or a model's.

## Decided by the owner

1. A waiting approval shows the short screen first; the details come when asked for ("Short screen", 21 November).
2. The heading for the choices stays "What each reply does" ("Keep it", 21 November).
