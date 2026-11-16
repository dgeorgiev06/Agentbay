# 14. Forge is built after manifests; the other features are deepened as they are touched

Date: 2026-11-16. Status: accepted by the owner.

**Decision.** The kernel restructuring stops being a gate once the manifests feature is done (slices M2 to M6). The order from there:

1. Forge, the build mode, with the kernel additions it needs.
2. The Gmail source and mail briefing, as forge's first real job.
3. The real-estate mode, through forge: listings from alert emails through the Gmail mode, parcels and sales from the New York State data.
4. The X source, todo with the importer, the Chief of Staff, improve and delivery.
5. Release 5.0.0, after an independent evaluation.

Broker with scripts, safety, check, agent-tools, command-line, harness, secrets and scaffold are deepened one at a time, each when forge or a mode next needs a change in it. A slice that touches one of them brings it behind an entry file first.

**Why.** Runs and manifests are the widest features and hold most of the boundary breaks. The feature-map test already stops new breaks everywhere. The owner wants something in daily use sooner, and a forge tried on two real modes before 5.0.0.

**Cost.** The boundary debt (42 kernel entries and 27 test entries on the day of this decision) stays above zero for longer. Forge is built on a kernel that is partly restructured, so its first slices may trip over a wide interface in broker or scripts; when that happens the feature is deepened then, not worked around.

**Unchanged.** The practices, the brief template, bug injection and the reviewer's checks apply to every slice, forge's included. Mode install stays after 5.0.0.
