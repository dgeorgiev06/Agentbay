# ADR 26: forge, whole: the design chosen and seven answers

Status: accepted, 18 November 2026. Decided by the owner. Amends ADR 22 in one rule.

Two designs were written apart from `docs/designs/forge-whole/0-frame.md` and compared in `comparison.md`, which holds the owner's seven answers as he gave them.

## Decision

1. Forge is built from design A's skeleton (`docs/designs/forge-whole/A.md`): requirements as a checked file, system design handed in as data, planning that must meet every condition, and a slice's rounds written out as steps a forge script drives, with no loop in the workflow form. From design B (`B.md`) come three pieces: a second mode that holds the tests where no forge agent can reach, a filter that lets a failing case's message through only when it shares no long run of characters with the tests, and a planter that never saw the tests to write the bugs.
2. The kernel refuses a skill step's output when the hook never saw its agent. Every card says which steps the hook saw.
3. The test writer never reads the builder's code.
4. The owner decides on the design's first card whether work takes the light or the full path. The interfaces are fixed either way.
5. A merge is made in a worktree of its own and the checked-out branch is fast-forwarded only when clean and unmoved.
6. The whole suite runs once a wave when forge runs waves; until then once a slice.
7. **Amending ADR 22:** a card leads with the answer and gives each check its mark and reason. Lines a script computed are attributed once for the card, not line by line. A line a model judged or a command ran still carries its own mark and its source, so opinion is never mistaken for a check. The kernel still checks every line's source by the kind of step it names.

## Consequences

- The first slice of all is a test that a script waiting on a skill step resumes with its finished calls replayed. Both designs lean on it and neither verified it. If it does not hold, the rounds need the workflow form to gain a counted repeat, as design B describes.
- Forge cannot be run for real in a session without the hook. Its slices are still built and tested there with the test toolbox; a live run is in Claude Code on the owner's machine.
- Today's `one-slice` workflow stays until the new one carries the todo mode, then goes.
