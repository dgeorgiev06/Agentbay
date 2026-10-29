# ledger (framework connector)

Implements `session.events/v1` and `review.verdicts/v1` for the improve mode, in env `improve-local`:
agentbay's own records as session episodes (dispatcher calls, agent runs, guard decisions, instruction-change
notes, from `.agentbay/ledger/events.jsonl`) and review verdicts with their round and subject (from call
state). Read-only.
