# comments-check

`standards.check/v1` for comments, one checker for every language. The dispatcher's standards step calls
`findings { root, configRoot }` on the call's start commit and on the working tree, and blocks when a file has more
comment lines than at the start.

- It reads the comment syntax from `spec.language` of every `<kit>/components/*/component.yaml` and covers each file
  under `root` that one of their `files` globs matches. A language a project defines in its own `components/` is
  not read; a new language ships in the kit.
- It returns one finding per comment line: rule `comment` and a message that never carries the text.
- Python (`comments: python`) is counted by `limits.comment_rows`, the function behind the `comment_lines` measure of
  `bay check --limits`: each `#` comment (a shebang is none) and each docstring line after the first.
- Another language lists `line` markers and `block` pairs. A small lexer skips `"`, `'` and backtick strings, ends a
  line comment at the end of the line, and counts one finding per line a block comment spans.
- A file that cannot be read or parsed is a warning, not a pass of its comments.

## Setting

In a project other than the kit, `rule: off` turns the rule off:

    connectors:
      comments-check:
        rule: off

It is read from the base's `agentbay.config.yaml` (`configRoot`), so a change cannot switch the rule off for itself.
In the kit the setting is ignored.

    python3 tests/run.py components/python/tests/test_python_check.py
