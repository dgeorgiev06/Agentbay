# 9. Replace and delete; never layer

Date: 2026-11-15. Status: accepted.

**Decision.** When code is replaced, the old code is deleted in the same slice. This holds for kernel code, mode code, tests, schemas, templates and docs.

- No compatibility shim, re-export, alias or wrapper is kept so that old callers keep working. The callers are changed.
- Nothing is kept "for later". Code with no caller in the kit is deleted; git has the history.
- Code that only tests call is dead. It is deleted with those tests, unless it is a private seam of a feature that the feature's own tests use.
- A slice's definition of done includes: every file, export and test that the slice made unnecessary is gone, and the report lists what was deleted with line counts.
- The dead-code tool runs with no exemptions. An exemption needs a decision record.
- A reviewer asks the deletion test of every file a slice touches: if it were deleted, would complexity vanish or reappear in the callers?

**Why.** Owner requirement. The kernel grew to about 13,800 lines in two days, and every fix so far has added lines. Agents add by default; deleting has to be a rule.

**Cost.** Nothing is backwards compatible inside the kit. A slice that replaces something must update every caller, so its diff is larger and its write scope must say so.

**Exemption in force (reviewer, 2026-11-15, after slice F1).** The earlier exemptions are gone and the dead-code tool runs twice, the second time without counting tests as users. One setting remains: an exported function that its own file also calls is not reported. Today it hides eight functions that tests import directly: `permissionsFor`, `policyFor`, `isReferenceText`, `parseReference`, `resolveReference`, `scriptCommand`, `stepKeyText`, `parseStepKey`. Each goes when its feature is deepened and its tests move to the entry file. The setting is removed with the last of them.
