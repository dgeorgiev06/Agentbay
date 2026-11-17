# 21. How a project's mode is trusted: a card from the kernel, a record in the kernel's folder, the owner's yes

Date: 2026-11-17. Status: accepted by the owner.

`0020` decided that a project's own mode may list commands when the owner trusts it by name. Three designs were written and compared (`docs/designs/trust/`). The owner chose.

**Decision.**

- Design B is the base. The kernel writes a card that shows the mode and every command it lists with its words and effects, and the throwaway folders it names. The owner answers it with `bay approve --trust <mode>` and `yes`. No new command is added.
- The trusted list is kept whole in `.agentbay/trust.json`, with a hash over it. A mode whose list is not trusted, or has changed since, loads without its list: everything else in the project runs, and a step that needs one of its commands is refused with a sentence that says what the owner can do.
- When a trusted list changes, the card shows what was added, what changed and what stayed.
- From design C: the broker reads the trust record again before each command, so that withdrawing trust reaches a session that is already open. And an agent's own shell in a skill step is given the commands of the kit's base modes only, never a project mode's.
- **The owner's word in chat may give trust**, as well as the owner at a terminal. The coordinator runs the approval and quotes the owner's words, which are recorded with it. The owner chose this knowing the cost the comparison states: an agent that invents the quote gives the trust. The recommendation was a terminal only.
- When a trusted mode's scripts change and its list does not, `bay check` reports which files changed and the trust stands. The listed words still bound what any script can run.

**What trust is and is not.** It stops a mode's script and an agent inside a run's step from granting commands to themselves, and it makes the owner see exactly what he allows, once, and again when it changes. It does not stop an agent that has the owner's shell or the owner's voice in chat. Every design says so, and the kernel's own words must not claim more.

**Closed with it, whatever the design:** a mode can no longer be granted the project's config file as a write path; and an agent's file tools are stopped from writing into the kit's base folder when the project is not the kit, since a mode placed there needs no trust.

**To try when the kit first runs on the owner's machine:** an entry in the operating system's keychain that asks for the login password on each read, as a barrier an agent with the owner's shell cannot pass. Untested.

**Order.** The manifest field for the words every command of a mode starts with (`0020`, item 4) is built first, because the hash is taken over the resolved words. Then the slices of design B's migration, then the typescript mode on a project that is not the kit.
