# ADR 29: a skill step names its role, a name the kit owns that gives it a tier

Status: accepted, 21 November 2026. Decided by the owner, on the design `docs/designs/roles/design.md`. Questions 4, 5 and 6 of that design are open. Amends ADR 24 item 8: a skill step names a tier or a role that gives one.

## Context

The owner, 20 November: "Why not have well defined rolls like reviewer lead builder etc that map to platform agents like Claude and define platform specific params like model effort etc. Then instructions can just say use a lead or use a builder to do this". And: "Why one agent per skill step."

A skill step named a tier, and nothing said which of the glossary's agents it was. The builder ran at two tiers: forge's `build`, in the workflow `one-slice`, at deep; `declare` and `build-without-tests` at balanced. The rules a role must hold were written in each skill, where its author remembered them, and checked against nothing.

## Decision

1. **A role is a name the kit owns, and each role has a tier.** The roles are builder, test writer, reviewer, planter, designer, challenger and planner, in `bay/roles.ts`, beside the tiers. A skill step names `role:` in place of `tier:` and runs at its role's tier; a step names one or the other, never both, and a step with no role keeps its tier. The config's `tiers` still give a tier its model and effort, so a role reaches a model through its tier, and the kernel names no model (ADR 2).
2. **The builder runs at balanced.** Builder, test writer, planter and planner are balanced; reviewer, designer and challenger are deep. Every skill step of forge names its role, and the `one-slice` workflow's `build` moves from deep to balanced. No other step's tier changes.
3. **A ceiling and standing rules follow, per role.** A role's ceiling only takes tools and roots away from what the step's grants and effects give, never adds one, and enters no list's hash. A role's standing rules are said once, for the role, in its agents' files. Both are built after the names (slices RL4 and RL5).
4. **One agent file per skill step, and a fresh agent per step, stay.** The hook sees an agent's type, never its task, so it can confine a step only by that step's own definition. What an agent has seen is what keeps the test writer, the builder and the planter apart, and a token ties each answer to one step. Who may see what stays a property of the step in its workflow, never of its role.

## The owner's answers

| Question | His answer | When |
|---|---|---|
| 1. Which option? | "2 roles and limits": names first, then limits; option D, built as option A first | 21 November |
| 2. Where a role's model and effort come from | "Through its tier (Recommended)" | by 21 November |
| 3. The builder's tier | "Sonnet (Recommended)": balanced | by 21 November |

## Rejected

- **One agent definition per role (option B).** A role's file would have to hold the union of its skills' policies, which widens a step (`declare` would get `Write` and `Edit`), or split by policy and stop matching roles. The hook could record only the role, not the skill, which weakens the sighting ADR 26 item 2 relies on. It saves two agent files of twelve.
- **Rewording the card only (option C).** A second place that knows which skill is which role, and none of what the owner asked for.
- **A role's own model and effort in the config.** It says a model in two places while role-less steps keep `tiers:`, and the owner chose through the tier. Slice RL6, which would let one role win over its tier, is not planned.
- **The builder at deep.** `declare` and `build-without-tests` would move to Opus, and every round would cost more.
- **A tier beside a role, winning over it.** It says the tier in two places (ADR 11).
- **A lead as a step agent that starts other agents.** The hook denies every subagent that is not a step, and the kernel, not an agent, decides what runs (ADR 2). The coordinator is not a step.
- **Merging agent instances across steps.** The test writer and the builder, the planter and either, the two designers, and the planner and its challenger must each be a fresh agent that has not seen the other's work.

## Still open

- **Question 4: the feed briefing's `digest` and `ask`.** They have no role in the glossary. Until answered they keep `tier: balanced`, the recommendation, which builds nothing.
- **Question 5: "lead".** The recommendation is the coordinator, named lead nowhere but in prose. Nothing is built, and `bay check` refuses `role: lead` as it refuses any name that is not a role.
- **Question 6: how a judged line names a role.** No card names a role until it is answered: a card still prints "by forge skills/review, tier deep". Slice RL3 waits for it.

## Consequences

- ADR 24 item 8, "The two implementers run Sonnet at medium effort", now holds in every forge workflow, `one-slice` included.
- A card that quotes the `one-slice` builder prints "tier balanced" where it printed "tier deep".
- The twelve agent files `bay build` writes for the kit are the same bytes as before, but `agentbay-forge-build.md`, whose model is the balanced tier's. Tools, roots and `.agentbay/steps.json` are unchanged.
- A role is a name only until the ceilings are built: ADR 27 item 3, that a builder has no tool that runs a command, still holds only because forge lists no command.
- Standing rules are sentences an agent can ignore. Only a ceiling is enforced, by the hook where it runs, and without the hook not at all (ADR 27).
