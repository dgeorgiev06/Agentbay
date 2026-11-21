# One approval screen

Slice AS1. The owner, 21 November 2026: "I don't read the card because it is hard to read. Every thing needs to be
easy clear", "Should in one place", and later "When I ask for details should be very clear as well". He answered
"Better" to a layout of fixed sections (the owner's words are kept in the slice's brief).

Today an approval's card is laid out in many places: the kernel (`bay/approval-card.ts`, `bay/trust-card.ts`), and
each forge script that writes its lines already wrapped for 44 columns (`draw.ts`, `draw-design.ts`, `draw-plan.ts`,
`draw-wave.ts`), and the pm mode. Each whole card is pinned in tests, so one changed word fails tests in files that
have nothing to do with it.

This note says how one kernel module draws every approval from facts, and converts one screen: forge's design card.

## The interface: a step hands facts, the kernel draws

A step hands the kernel facts as data, never laid-out lines. The facts are what the workflow's `show` points at,
the same place a card is today, so the approval's hash covers them with no change to hashing.

```
Screen  = { title, lines: Fact[], withheld?: { <choice>: <reason> } }
Fact    = { section, short?, mark, words, source }
section = "what" | "checks" | "open" | "problems"
short   = true when the fact belongs on the short screen; left out, it is shown in the details only
mark    = "computed" (a script worked it out) | "ran" (a tool ran it) | "judged" (a model wrote it)
words   = one line of text, at most 600 characters
source  = { step, command?, run?, item? }   (as a card line's source today)
```

- `title` is the question: what is approved, about what ("Commit the design of todo?").
- `what`: what it is. `checks`: what ran, how many, what came out ("34 automatic checks: no problem found").
  `open`: what the work leaves undecided. `problems`: what withholds a choice, when anything does.
- What each reply does is not a fact a step writes: the kernel takes each choice's `does` from the workflow, and the
  reason a choice is withheld from `withheld`, as today.
- A card whose every line has a `section` is a screen; one where only some lines have one is refused. A card with no
  `section` on any line is today's card and is drawn as today, so both forms live side by side while screens are
  converted one at a time.
- The kernel checks every fact's source as it checks a card line today (`bay/runs/card.ts`): a `computed` fact cites
  a step that ran no skill, a `judged` one a skill step the approval quotes (the kernel adds the skill and its tier),
  a `ran` one a command the kernel recorded. Nothing new: a screen's facts are card lines with two more fields.
- Not in this slice: a fact with a long value (a schema, an example) shown as a block of its own; the design card
  shows counts, not schemas. It is a field `value` on a fact, added with the first screen that needs it.

One module, `bay/approval-screen.ts`, draws both views. Its interface is small:

```ts
screenOf(approval): Screen | undefined          // a screen when every line of its card has a section
screenLines(screen, runId): readonly string[]    // the short screen
detailsLines(screen, record, section?): readonly string[]   // record: runId, steps, decide command
sectionNamed(name): Section | undefined          // for `--section`
sectionNames(): string                           // to say which names there are
```

All are pure: values in, lines out. `bay/approval-card.ts` keeps drawing today's cards and hands a screen to the new
module, so `bay runs` and the terminal's `bay approve` both show the short screen; `bay/run-report.ts` asks for the
details when `bay runs` is given `--details`. The few helpers both modules use are in `bay/approval-words.ts`.

## The short screen

Fixed sections in a fixed order, each left out when it has no fact. The design card of the todo mode, as `bay runs`
prints it:

```
COMMIT THE DESIGN OF TODO?

What it is
  1 module, 4 actions: add, list, done and
    remove.
  Covers all 13 of your conditions.
  and 16 more, see details

Checks
  34 automatic checks: no problem found.
  A second model reviewed it and reported no
    findings and no practice not held.
  and 5 more, see details

What each reply does
  approve: Commit the design and its schema
    files
  stop: Stop; nothing is committed

Reply: approve or stop
Details:
  bay runs <run> --details
```

- The order: the question, What it is, Checks, Not decided, Problems, What each reply does, Not available now (each
  choice withheld, with `Why:` and its reason, whole), the reply.
- Rows are at most 44 columns, but for commands, which are kept whole so they can be copied. Each section shows at
  most 4 rows of its short facts. A fact is shown whole or not at all, never cut, and a later fact is never shown in
  place of one that did not fit. When a section has facts that are not shown (details-only ones, or short ones past
  the 4 rows), its last row says how many: `and 3 more, see details`. The four fact sections hold at most 16 rows;
  the design card's short screen is 20 rows.
- Who produced a fact, in plain words: a script's fact is shown as it is; a model's facts are led by a row `A model
  wrote:` and indented under it; a tool's by `<command> reported:`. Section headings are never indented, facts always
  are.
- Words used: "approve", "reply", "details", "checks", "a model wrote", "see details". Not on the short screen:
  "card", "judged", "computed", "packed", "hash", "mark".

## The details

`bay runs <run> --details` prints every fact, in the same sections and the same order, nothing left out (no "and 3
more"). It starts with `In this view`: one row per section and how many facts it has, and how to ask for one alone,
`bay runs <run> --details --section checks`, for a reader on a phone.

- Facts are grouped under who produced them, in plain words, with the step: `A script worked it out, in step
  draw:`, `A model wrote, in step designs (forge skills/design, tier deep):`, `The command npm-test ran in run r2, in
  step prove:`; for a step in a foreach's item, the item by its name. Facts that follow one another from the same
  source share one such row.
- Each fact is its own block: its first row at four spaces, the rows it wraps onto at six.
- Then what each reply does, the choices not available with their reasons, and the reply, as on the short screen.
- The machine parts come last, under `For the record`, which says its lines are for copying and so not wrapped: the
  steps of the run (a step whose output is kept packed reads `output kept but never printed`), the full hash, and
  the command to decide. Nothing machine-like is mixed into the sections above, and `bay runs` without `--details`
  prints neither the steps nor the command for a screen.

Chosen over levels of details (a short details view, then a full one): one details view that holds every fact keeps
"nothing left out" true without a third thing to read, and `--section` covers the phone. The design card's details
are about 130 rows, three or four phone screens, of which 34 are the steps under `For the record`.

## What the hash covers

The hash is the hash of what `show` points at, scrubbed of secrets, as today: the title, every fact with its
section, `short`, mark, words and source, and the withheld reasons. Both views are pure functions of those checked
facts plus the choices and the record, so no fact the approval rests on is outside the hash. Two things on the
screen are not in it, as on today's cards: each choice's `does`, which is the workflow's text, and the skill and
tier the kernel adds to a model's fact, which it reads from the run. Hashing those too is a later slice (it changes
every approval's hash).

## Security properties that must not weaken

1. Whole on request. Every fact the approval rests on is in the details, whole. The short screen is a view of the
   same hashed facts; when it leaves facts out it says how many, per section, and where they are.
2. No verdicts. No sentence the kernel writes claims that steps were confined, that nothing leaked, or that code, a
   design or a plan is good, correct or safe. The kernel writes only headings, who produced a fact, counts of facts
   left out, choices and their reasons. Steps say what was reported: "A second model reviewed it and reported no
   findings", not "no problems left".
3. A model's words never read as a script's. A `judged` fact is always led by a row `A model wrote:` on the short
   screen, and indented under it where a script's fact is not; in the details it sits under `A model wrote, in step
   ...`. The kernel checks that a `computed` fact cites a step that ran no skill, as for card lines today.
4. No forged headings, choices or reply line. Every fact is one line of words: the kernel shows control characters,
   bidi controls and marks (U+061C, U+200E, U+200F, U+202A to U+202E, U+2066 to U+2069) and U+2028, U+2029 as
   `\uXXXX` (in `shown()`, so every card gains this), and a fact cannot break onto a row of its own. Facts are
   always indented and headings and the reply line never are. The title, the one unindented text a step writes, is
   printed in capitals, so none of its rows reads as `Reply:` or a heading. The kernel refuses words past 600
   characters and a title past 200, and a card where only some lines have a section. A choice's name and reason are
   shown the same way.
5. Choices not available keep their reasons, whole, on the short screen.
6. Chat approval is unchanged: the owner's own quoted words and the full hash (from `--json`, or the details).

## Migration, one screen a slice

Each slice converts one screen: its script hands facts with sections, its tests ask facts (which choices are
offered, counts, problems) through the helpers `factsOf`, `offeredOf` and `withheldOf` in forge's
`tests/kit-copy.ts`, and whole-text pins of that screen are removed. The wording is pinned once, in
`tests/inside/command-line/approval-screen.test.ts`.

In AS1, the design card's text was pinned in 4 test files (`design-card`, `design`, `designs-apart`,
`rules-in-a-design`), through a copy of the kernel's layout in forge's `tests/printed-card.ts`. After it, none: the
four ask facts, and the layout is pinned in the screen module's own test file only.

1. AS1, this slice: forge's design card. The `open` section is left out: it needs a "not decided" answer from the
   challenger, which changes a skill's output schema.
2. AS2: the challenger's "not decided" answer, which fills `open` on the design card.
3. AS3: forge's path card (the design's first card, `path-card.ts`).
4. AS4: forge's plan card (`draw-plan.ts`).
5. AS5: forge's start and merge cards (`draw.ts`), the biggest; may split by card.
6. AS6: forge's wave cards (`draw-wave.ts`).
7. AS7: the pm mode's cards, on its branch.
8. AS8: the trust card (`bay/trust-card.ts`), which is drawn from the manifest, not from a step.
9. Last: delete the old card layout in `bay/approval-card.ts` and forge's `tests/printed-card.ts`, which copies it.

Forge's `given` outputs (`tests/given-*.json`) are captured before the draw step, so a converted draw script changes
none of them and needs no recapture. A given that holds a drawn card would be recaptured in the slice that converts
that card.

The coordinator's block says to show "every line it prints for the approval, unchanged and whole". Proposed, once
every screen is converted (not changed in this slice): "Show the owner the approval screen `bay runs <run>` prints,
unchanged and whole. When he asks for details, show what `bay runs <run> --details` prints, unchanged and whole."

## Open questions for the owner

1. When you look at a waiting approval, should it print the short screen (about 20 lines) and give the details only
   when you ask, or print the details every time? This slice prints the short screen.
2. Should the design challenger have to list what the design leaves undecided (the "Not decided" section), so a
   design cannot reach you without that list?
3. When an approval has more than approve and stop, is "What each reply does" with one line per reply clear, or do
   you want "If you approve" for approve alone?
