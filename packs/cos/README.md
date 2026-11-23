# cos

Chief of Staff: a main agent that routes work to your other packs and keeps durable facts about you.

cos runs only in a dedicated home project, never as a global default.

1. Add the marketplace with `/plugin marketplace add dgeorgiev06/agentbay`, then install with `/plugin install cos@agentbay` and `/plugin install todo@agentbay`.
2. Create a home folder and open it in Claude Code.
3. Run `cos setup` and `todo setup`; each prints `{"allow": [...]}`.
4. Put those allow rules and the agent in the folder's `.claude/settings.json`:

```json
{
  "agent": "cos:cos",
  "permissions": { "allow": ["Bash(cos *)", "Bash(todo *)"] }
}
```

Or skip the setting and start with `claude --agent cos:cos`.

Data lives in `$AGENTBAY_HOME/cos/cos.db` (default `~/.agentbay`). `cos export` prints all of it.
