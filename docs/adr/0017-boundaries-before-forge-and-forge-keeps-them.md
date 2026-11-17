# 17. Boundaries are fixed before forge continues, and forge is built to keep them

Date: 2026-11-16. Status: the first part accepted by the owner; the second part proposed, for the owner to accept or change.

The owner saw that slices which each added one mode also changed many shared files, and asked for an audit (`docs/research/2026-11-16-boundary-audit.md`). It confirmed it: runs and manifests are real boundaries, mode source is clean, and the area every mode leans on (toolbox, script protocol, script runner, broker, effect rule, shared types, ports) is not a module. A new mode also edits three lists by hand and copies its interface's schemas.

## Decided

- All ten changes of the audit are made before forge continues. This replaces the part of `0015` that left deepening broker and scripts to forge's early jobs.
- A mode is isolated: adding a mode changes only its own folder and its interface. A test enforces it.
- A capability a mode needs from the kernel is its own slice, built first. It is never added inside a mode slice. (G1 did this; G2 and G3 did not, and the reviewer's briefs allowed it.)
- Two builders work at a time, on slices whose write scopes do not overlap. Slices in the same kernel feature stay one after another.
- From the study of swamp, two things go in before 5.0.0: one shared test file per interface that every implementing mode passes, and a small set of questions per mode that checks a model picks the right action from `bay actions`. The rest wait as `0016` says.

## Order

Two chains, side by side.

Kernel chain, one slice after another:
1. K1: the grants shape is built in one place; the file port is split so that only the broker carries make-folder, link and remove.
2. K2: three designs for broker, scripts and the effect rule as one feature with one table per operation, then the owner's choice where the designs differ in what he would see.
3. K3 and on: build it, sealed; the toolbox's types live in `sdk.ts` alone with a test pinning its surface; effects for a command are scoped per listed command.

Isolation chain:
1. I1: the feature map covers modes by a pattern; no kit test lists the kit's modes or their manifest lines; the kit's tool configuration moves out of the typescript mode.
2. I2: a mode's action takes its schemas from its interface; the copies are deleted.
3. I3: the mode harness becomes a declared test toolbox that does not hand out the kernel; the feature-map test covers what mode tests import.
4. I4: a test that a mode's folder and its interface are all a new mode adds, and the two swamp items.

Then G4 onward as `0015` orders them.

## Proposed: how forge keeps boundaries

1. **Every slice has a kind and a write scope, and a script enforces it.** A mode slice may change only `components/<tier>/<mode>/` and its interface folder. A capability slice names one kernel feature and may change only that feature, its tests and the toolbox. The proof kind "changes are in scope" (G4) compares the paths changed with the scope and fails the slice on any other path. No model judges this.
2. **A builder that lacks a capability stops.** A mode builder that needs something the toolbox does not have reports it and ends. Forge then plans a capability slice first. A builder's skill has no instruction that lets it add to the kernel from a mode slice.
3. **The toolbox's surface is pinned.** A change to it is shown on the owner's first card in one line: what every mode could do afterwards that it could not before. A slice that changes the surface without saying so in its plan fails.
4. **The merge card shows spill.** Two numbers from scripts: paths changed outside the slice's scope (must be 0), and kernel features a capability slice touched. A capability that touches more than two features is merged only with a finding recorded, and the finding becomes a deepening job.
5. **Sealed features only grow.** The list of features with nothing private reached from outside never shrinks. A slice that adds to either debt list fails; the lists may only shrink.
6. **The plan proves slices do not overlap before any is built.** Scopes of slices planned to run together are disjoint, checked by script. That is what makes two builders safe.
7. **The audit is repeated by script.** What can be counted without a model is counted on every merge into the integration branch: files changed together across slices, lists edited by more than one slice, copied files, exports per entry file. A number that worsens is shown on the merge card.

**Cost.** Items 1, 5 and 6 are scripts on top of what G4 and G5 already plan. Items 3, 4 and 7 are new, about one slice together. Item 2 makes some jobs take two slices where one would have done, which is the point.
