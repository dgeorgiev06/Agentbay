# agentbay

A personal Chief of Staff built as a Claude Code plugin marketplace. Each pack is a plugin with its own skills, agents, JSON commands and workflows. There is no framework code.

| Pack | What it does |
| --- | --- |
| cos | The Chief of Staff: routes requests to packs by their descriptions and keeps memory |
| todo | Personal todo list: add, list, finish |
| dev | Plans and builds software in reviewed slices with lead, test-writer, runner, builder and reviewer agents |

## Install

```
/plugin marketplace add dgeorgiev06/agentbay
/plugin install todo@agentbay
/plugin install cos@agentbay
/plugin install dev@agentbay
```

Then add each pack's permission rules once: run `todo setup` and `cos setup` and put the printed rules in your settings. To talk to the Chief of Staff, set it up in a home project as described in `packs/cos/README.md`.

## Develop

- The pack contract and merge rules: `docs/PACKS.md`
- Tests: `npm test` (Node 22.18 or later, no dependencies)
- Validation: `claude plugin validate .`
- Evals per pack: `claude plugin eval packs/<name> --ablation none --runs 1`

## License

MIT
