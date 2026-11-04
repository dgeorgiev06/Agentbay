# python-check

`standards.check/v1` for Python. The dispatcher's standards step calls `findings { root, configRoot }` twice, on the
call's start commit and on the working tree, and blocks on a finding the start commit lacks.

- It runs `python3 -I -m ruff check` and `python3 -I -m mypy` on `root` through `bay.standards.run_module`: a list of
  arguments, no shell, a timeout (60 s for ruff, 120 s for mypy), and `-I`, so a planted `ruff.py` or `mypy.py` is
  never imported.
- ruff gets `--no-cache --ignore-noqa --output-format json --config <file>`. mypy gets `--config-file <file>
  --cache-dir <a temporary folder> --output json`, so neither writes in the project.
- Every config comes from `configRoot`, the base export. The config in `root` is never read, and a mypy plugin
  resolves next to the base's config file.
- It adds a finding for each `# mypy:` comment (`mypy-inline`) and each `type: ignore` comment (`type-ignore`).
- `stopped` names a timeout, exit code 2 or output that is not JSON, so a tool that did not run is never a pass.

The config files, the tools and their pins are described in `components/python/README.md`. It takes no settings.

    python3 tests/run.py components/python/tests/test_python_check.py
