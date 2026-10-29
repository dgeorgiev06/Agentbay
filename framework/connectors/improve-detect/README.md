# improve-detect (framework connector)

Implements `improve.detect/v1` for the improve mode, in env `improve-local`: `sessions`, `artifacts`,
`resolve` and `recheck` run the session and artifact detectors and return candidate findings. Read-only: it
never writes findings (that is `improve-store`).
