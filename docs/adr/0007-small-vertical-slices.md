# 7. Work is cut into small vertical slices

Date: 2026-11-15. Status: accepted.

**Decision.** A slice is one feature or one mode, with a brief in the seven-section format and its own definition of done. Its write scope is that feature's folder plus declared changes to shared types.

**Why.** Large horizontal slices could not be reviewed properly: one changed 63 files.

**Cost.** More slices, more merges, and some cross-cutting work needs files moved first.
