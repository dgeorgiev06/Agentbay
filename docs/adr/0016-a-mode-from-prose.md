# 16. A mode starts as prose from the owner, and forge leaves as little prose in it as it can

Date: 2026-11-16. Status: accepted by the owner.

The owner read how swamp (`swamp-club/swamp`, AGPL; ideas only, no code) has an agent turn a chore into typed pieces and a workflow that reruns with few model calls, and asked for the same from forge.

**Decision.**

- The owner describes a mode in prose: what it is for, what he would ask it, what it should give back. That is the whole request. He does not write a manifest, an interface or a workflow.
- Forge proposes the mode from that prose: its actions with descriptions, the interfaces it implements or requires, its workflows, its effects and grants, and which steps are scripts and which are skills. The proposal is what the first approval card shows, as the output the owner would see.
- For every step, forge prefers a script. A step is a skill only when the proposal says what a model must decide there that a script cannot. The proposal lists the skill steps with that reason, and the card shows the count.
- A skill that is built holds only that decision, in the seven sections, with no instructions a script could carry out (P-32).
- The same path serves "make this chore a workflow": the prose may be a description of something the owner has done by hand or asked an agent to do several times.

**Where it lands.** G8 (the stages before the build: restate, propose, plan, challenge, and the two cards). G7 is unchanged. The todo mode is the first mode asked for this way.

**Later, in the improve mode, after the todo mode.** Finding repeated chores in the harness's session history with a script and no model, offering them, and reporting what a chore cost before and after it became a workflow. Reading session history needs the owner's yes each time, and each harness stores it differently, so it sits behind the adapter.

**Also taken from the same study, for later slices:** one shared test file per interface that every implementing mode must pass; a small set of questions per mode that checks a model picks the right action from `bay actions`.

**Not taken:** code running inside the kernel's process, a required account, an expression language, compatibility names. Each contradicts `0003`, `0005`, `0008` or `0009`.

**Cost.** The proposal stage must judge what needs a model, and that judgement is a model's word. The card labels it as such. A mode with too few skill steps fails in use where the input was messier than the script allowed; the fix is a new forge job, not a wider skill.
