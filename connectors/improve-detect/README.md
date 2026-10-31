# improve-detect (framework connector)

Implements `improve.detect/v1` for the improve mode, in env `improve-local`: `sessions`, `artifacts`,
`resolve` and `recheck` run the session and artifact detectors and return candidate findings. Read-only: it
never writes findings (that is `improve-store`).

`change {base}` is the dead-code check forge.extend runs on every change. It audits the working tree and the tree
at `base` (exported with `git archive` into a temporary directory; its code is never run) and returns
`{new, existing}`: the findings of kind unused, unused-constant, compat-layer and complexity whose fingerprint is
absent at `base`, and how many already existed. When `new` is not empty the output carries `stopped`, which ends
the calling code step `blocked`.
