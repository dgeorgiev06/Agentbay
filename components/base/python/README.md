# python

The Python standards (proposal 0011): the `language` block in `component.yaml`, the config the checks run with and the
connector `python-check`.

## What it holds

- `component.yaml`: `language` names the files it covers (`*.py`), the comment syntax (`python`, counted with
  `tokenize`), the tools with their pinned versions and the `install` text a missing tool prints.
- `ruff.toml`: rules `E`, `F`, `W` and `B` at line length 120, no preview rules. E402 is ignored in `bay/cli.py`,
  `bay/hook.py` and `bay/use_shim.py`: an entry script must set `sys.path` before it imports `bay`, and in
  `use_shim.py` that order is the security measure.
- `mypy.ini`: `strict = True`, tests excluded.
- `connectors/python-check`: `standards.check/v1`. It runs `python3 -I -m ruff` and `python3 -I -m mypy` on one
  folder, so a planted `ruff.py` or `mypy.py` never runs. It reports every `# mypy:` line and every `type: ignore`
  comment as a finding of its own, because mypy has no switch that turns inline config off.

## Which config

Every config is read from the base export (`configRoot`), never from the folder under check, so a config or a plugin
that a change adds is not read until it has landed.

- In the kit: `components/base/python/ruff.toml` and `components/base/python/mypy.ini` of the base.
- In another project: its `ruff.toml`, else its `pyproject.toml` when it has a `[tool.ruff]` table, and its
  `mypy.ini`. mypy does not read `.mypy.ini`, `setup.cfg` or `[tool.mypy]`. A tool without a project file uses the
  kit's file.
- mypy checks `-p <folder>` for each top-level folder that holds Python outside `tests/`, and the top-level `.py`
  files. A project `mypy.ini` that sets `files` or `packages` chooses its own targets.

## Tools

    pip install -r requirements-dev.txt

A missing tool stops the step with that command. A version other than the pin is a warning.
