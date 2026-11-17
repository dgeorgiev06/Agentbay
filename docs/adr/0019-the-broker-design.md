# 19. The broker is one sealed feature built as a table of operations, with a ruling per operation

Date: 2026-11-16. Status: accepted by the owner.

Three designs were written under different constraints and compared (`docs/designs/operations/`). The owner chose the recommendation.

**Decision.**

- Design A is the base: one feature `bay/broker/` with two entries, `broker.ts` for the kernel and `bay/sdk.ts` for modes. One table of operations, typed over one union of names so that a missing entry does not compile. The runner, the protocol and the effect rule name no operation. `sdk.ts` is written by hand and declares every shape a mode's author can reach; a test pins its surface.
- From design C, the ruling: each operation has a rule that returns what was allowed, and its handler receives that and not the request. A handler cannot act on something unchecked because it is never given it. C's further split into record and answer, and its transport port, are not taken now.
- From design C, proofs over every operation through the entry, from two examples each.
- From design B, `valueOf` in the toolbox, since four modes each wrote it.
- From design B, a mode lists its commands by name. Each named command gives the words it runs and its own effects, and a script names the command and passes only the arguments that vary. The rule is an exact lookup; matching by leading words is deleted. An action may run the commands whose effects it declares.
- The transport between the kernel and a script stays as it is until a container or a second adapter needs a port (P-10).

**Before the later slices are briefed, tried in code:** the full table of shapes for all 16 operations; the two operations that may not fit "rule, then handler" (a web request, whose redirects are checked while it runs, and the database's late refusals); and the test that pins the toolbox's surface. If the two do not fit, the ruling becomes optional per operation and the owner is told, since most of its worth would go.

**Order.** A chain in the kernel, one slice after another because they share a feature: move the files; the interface and the table of shapes with the pin; protocol and host read the shapes; files and database become entries with rulings; the rest follow and the old class, the old rule file and the switches are deleted; seal; commands by name with effects per command. Then the two modes that run commands declare true effects, side by side. The isolation chain of `0017` runs beside all of it.

**Cost.** About seven kernel slices before G4. For one slice the table is half moved. Named commands change what a mode's author writes, once.

## Also decided the same day

- Unattended runs: decided after the todo mode, as `0015` left it.
- The second model that challenges plans, reviews slices and evaluates before 5.0.0 is another Claude model: builders on one, reviewer and challenger on another.
- "Builds any product" (`0018`) is tested on a new small TypeScript project that forge starts from an empty repository and a request in prose.
