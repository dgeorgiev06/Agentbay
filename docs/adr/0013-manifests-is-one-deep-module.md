# 13. Manifests is one deep module, and it hands out only a policed system

Date: 2026-11-15. Status: accepted by the reviewer under the owner's standing instruction to decide what works; reversible until slice M3 lands.

Three designs were written under different constraints and compared (`docs/designs/manifests/`). All three agreed on the first four points below. This is a hybrid of the rest.

**Decision.**

- The manifests feature is one module in `bay/manifests/` with one entry file, `bay/manifests/manifests.ts`.
- `loadSystem(files, layout)` is the only way to get a system, and it returns one only when every manifest, binding and grant is sound. There is no unpoliced system to hold. `loadPolicedSystem`, `PolicedSystem` and `PolicyOf` are deleted.
- The dependency between safety and manifests flips. Safety's grant rule takes one mode's manifest and folders as plain data and returns grants or placed wordings. Manifests calls it while loading. Safety no longer imports manifests.
- The type generator is a development tool. It moves to `scripts/` and is not kernel code.
- Seams are design C's. Reading one file against its schema, and wording its problems with lines, is private to the feature. Files are the only port. The YAML parser and the schema checker are not ports.
- The system answers questions (designs A and B): `system.action(reference)`, `system.workflow(mode, path)`, `system.listing(question)`. Resolving `mode.action` and `interface.action` is a question to the system; `bay/targets.ts` is deleted.
- What a question returns carries what the caller needs next (design B). An action target holds its input and output schemas, each with a `check` that returns problems. A workflow target holds `resolve`, which evaluates `$trigger`, `$steps.x.output`, `$item` and `$settings.k` against a scope the caller supplies. Callers no longer read schema files or pick references apart themselves.
- `bay check` and `bay new` get what they need through two further calls: `inspectSystem`, which returns the folders found and every problem, and from which `loadSystem`'s failure is derived, so the two cannot disagree; and `placeToWrite`, which says where a new part goes. The second loader in `bay/check-context.ts` and the folder rules restated in `bay/new.ts` are deleted.
- Skill front matter is read when asked, as today. References are parsed and evaluated in manifests; runs supplies the scope.
- Tests assert through the entry file. Fixtures that build a system as a literal load one from fake files instead.

**Why.** One file of 1,347 lines finds folders, reads YAML, validates, resolves interfaces and bindings, works out the active set and lists actions. Other features import 30 names from four files, and 15 of the 43 boundary breaks reach into them. A caller that forgets to load through safety holds an unchecked system. Design A's eight names understated its interface: it handed every caller the whole manifest type to pick apart. Design B's targets remove that for the common paths.

**Cost, and the objection that stands.** Both B and C warned that manifest-related rules of neighbouring features collect in this one feature, and that the inspection side grows with every new check. That is accepted. The feature map keeps it behind one entry file, and its size is reported at every slice.

**Slices, each green on its own.**

1. M1: move the files into `bay/manifests/` and the generator into `scripts/`. Nothing else changes.
2. M2: the flip. Safety's grant rule takes plain data; `loadSystem` applies it; every caller of `loadPolicedSystem` moves; it is deleted.
3. M3: the entry file with the questions. Runs asks `system.action` and `system.workflow`; `bay/targets.ts` is deleted.
4. M4: targets carry schemas and `resolve`. Runs, harness and check stop reading schemas and references themselves; `spec.ts` and `references.ts` become private.
5. M5: `inspectSystem` and `placeToWrite`. Check's second loader and scaffold's folder rules are deleted.
6. M6: tests move to the entry file; fixtures load from fake files; names exported only for tests stop being exported.
