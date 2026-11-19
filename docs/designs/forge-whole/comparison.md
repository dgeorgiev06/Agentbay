# Forge, whole: the two designs compared

A (`A.md`) is the smallest change to today's forge. B (`B.md`) is forge as it would be written today for an owner who builds outside the kit. Both were written from `0-frame.md` without sight of the other. This note is the reviewer's; the owner decides.

## Where they agree

- Requirements are one YAML file a script checks: outcomes, each with conditions as given, when, then. A condition names no kind of proof; the plan does.
- A design is handed in as a skill's output, not written to files, so two designers cannot read each other. A script lays the chosen one out. Small work gets one design and never skips the interfaces.
- A plan must meet every condition, and a script checks it.
- The builder hears a failing case's name and at most a restricted part of its message.
- Practices are marked by who holds each: a tool, proof, or the reviewer; the reviewer's list is drawn from the file.
- A tier names a model and an effort in the project's settings (a small kernel change). Forge must be allowed outside the kit (a small kernel change).
- Cards answer first and give a failure's reason. The todo mode is rebuilt through the new flow as the test.
- Neither verified that a script which waits on a skill step resumes with its finished calls replayed. Both read it in the code; no test holds it.

## Where they differ

| | A | B | Reviewer's view |
|---|---|---|---|
| Rounds | Three rounds written out as fixed workflow steps; a forge script calls who is needed. No kernel change. | The workflow form gains `when` and `repeat` (about 140 kernel lines). | A first. It rests on the unverified resume; test that first. If it fails, B's kernel change is the fallback. |
| Hiding the tests | By time: tests are on disk only while the test writer works, then held in git only. | By place: a second mode, `forge-tests`, whose folder no forge agent can reach. | B. A separation that holds at every moment is stronger than one that depends on the order of steps. |
| What a failing case tells the builder | Its name and the first line of its message. | Its name, and its message only when it shares no run of 20 characters with the test files. | B's filter. A first line can carry the test's data. |
| Who writes the bugs to plant | The reviewer. | A planter that never saw the tests. | B. A reviewer who has read the tests can only write bugs it already knows they catch. |
| The whole suite | Once a slice, at the end; rounds skip it. | Once a wave; a slice's proof runs its own tests, bugs and scope only; one merge card a wave. | A now, B when forge runs a wave. Until a wave runs at once there is nothing to share the suite across. |
| A step the hook did not see | No card claims the builder was confined; a later slice records where an output came from. | The kernel refuses the output, and every card says which steps the hook saw. | B's, and it is the owner's call: it means forge cannot run in a session without the hook, such as the cloud session that ran it on 18 November. |
| Practices file | Reads today's tables. | Becomes YAML. | A. The tables are already read by a script. |
| Size | 15 slices, 7 waves; 2 kernel changes. | 21 slices, 9 waves; 6 kernel changes, one not yet designed. | A's order with B's three pieces added is about 17 slices. |

## Recommendation

A's skeleton, with three pieces of B: the second mode that holds the tests, the filter on a failing case's message, and a planter for the bugs. The suite once a slice until forge runs a wave. The first slice of all is the test that a script waiting on a skill resumes; the design stands or changes on it.

## For the owner, one at a time

1. A's skeleton with B's three pieces, or A whole, or B whole.
2. Whether the kernel refuses a skill step's output the hook did not see.
3. Whether the test writer may read the builder's code in later rounds.
4. Who decides that work is small.
5. Where a merge lands.
6. The whole suite once a slice or once a wave, when waves run.
7. The clearer card: one mark above the lines it covers, in place of a mark on every line (changes ADR 22).

## The owner's answers

1. **The design** (18 November, "Recommendation"): A's skeleton with three pieces of B: the second mode that holds the tests, the filter on a failing case's message, and a planter that never saw the tests for the bugs.
2. **A step the hook did not see** ("Refuse it"): the kernel refuses a skill step's output when the hook never saw its agent, and every card says which steps the hook saw. Forge therefore does not run in a session without the hook; real runs are in Claude Code on the owner's machine.
3. **The test writer and the builder's code** ("No, never"): the test writer works from the conditions, the interface and the reviewer's finding, in every round.
4. **Small work** ("I decide on the first card"): forge proposes the light or the full path with its reason; the owner picks. The interfaces are fixed either way.
5. **Where a merge lands** ("Fast-forward the checked-out branch when clean"): the merge is made in a worktree of its own, then the checked-out branch is moved forward only when it has no uncommitted change and nothing else moved it; otherwise it stops and says why.
6. **The whole suite** ("Once per wave"): a slice's proof runs its own tests, planted bugs and scope checks; the whole suite runs once on a wave's combined result, with one merge card a wave; on a failure it is run again per slice to find the cause. Until forge runs a wave, once a slice.
7. **The card** ("Yes, adopt the clearer card"): the answer first; each check with its mark and its reason; where the lines came from said once for lines a script computed; a line a model judged or a command ran still carries its own mark. This amends ADR 22's rule that every line carries its mark.
