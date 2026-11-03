# store.delete

## Purpose
Remove the items the owner named from the store, after showing them and asking, and keep a synced item from coming back.

## Inputs
- `ids` (required, 1 to 50): item ids, `<source>:<extId>`.

## Steps
1. `preview`: the dispatcher reads the items with `items.store/v2.get`; the gate shows them.
2. `confirm`: a gate. The owner approves with `bay approve` or rejects; nothing is removed before.
3. `remove`: the dispatcher runs `items.store/v2.delete` (code step, no agent). One transaction removes the rows and saves the id of a synced item in the store's deleted list.
4. `review`: the reviewer checks the result (`deleted`, `missing`, `remembered`) against this Definition of Done and the rules before the call completes.

## Definition of Done
- [DOD-1] (must) Every id in `deleted` is listed under `missing` by `items.store/v2.get`.
- [DOD-2] (must) `deleted` holds no id outside the call's `ids`; each other id of the call is in `missing`.
- [DOD-3] (must) Every deleted id whose source is not `local` is in `remembered`.

## Outputs
`{deleted, missing, remembered}`.

## Failure handling
- Rejected at the gate: the call ends blocked and nothing is removed.
- An id that is not stored is listed under `missing`; the others are removed.
- Review fails a must item: the call ends `partial` with the reviewer's evidence; the items already removed stay removed.
