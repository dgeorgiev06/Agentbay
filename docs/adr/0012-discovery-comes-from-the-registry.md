# 12. What agentbay can do is asked of the registry, live

Date: 2026-11-15. Status: accepted by the owner.

**Decision.** A harness's model learns which modes and actions exist by asking the kernel, which answers from the registry at the moment of the call. No list is written into a harness's own files.

- One function in the kernel answers. It is offered as the command `bay actions` and as a kernel tool on the tool server.
- It discloses in two steps. Asked with nothing, it returns each active mode's name and description. Asked with a mode, it returns that mode's actions: name, description, effects, input schema.
- An optional text filter matches words against names and descriptions to shorten the list. It ranks nothing and chooses nothing.
- Every action has a required `description`: one sentence, in the owner's words, saying when to use it. `bay check` refuses an action without one.
- The call needs no task token. It is read-only and returns manifest contents only: no settings, no data, no secrets.
- A harness adapter tells its session one thing: to find out what agentbay can do, ask. It carries no list.

**Why.** The owner asked how a model knows that "list my todos" belongs to the todo mode. It did not: the instructions the Claude Code adapter writes say how to run an action, not which exist, and actions had no description. A list written into `CLAUDE.md` would be stale until the next build and would mean nothing to another harness. The registry already knows every mode on every call. The kernel still drives no model (`0002`): it says what exists, and the harness's model matches the request.

**Cost.** Two short calls the first time a session needs a mode. Every existing action needs a description. The tool server gains a tool that takes no token, so its handler must be unable to reach anything but manifests.

**Later.** The Chief of Staff mode uses the same call; it keeps no catalogue of its own. Offering each action as a tool of its own is left open.
