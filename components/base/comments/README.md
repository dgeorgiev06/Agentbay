# comments

The comment rule (proposal 0011), in one place: the kit has no `#` comment, and a docstring is one line.

- No `#` comments. A shebang is not a comment, and Python held in a string as test data is not code.
- A docstring is one line. A reason the code must keep goes in a name, an error message or the README.
- `connectors/comments-check` is the checker. It covers every language whose component declares a `language` block,
  so a new language adds its comment syntax there and nothing here.
- `bay check --limits` holds the same rule for Python in the kit: the `comment_lines` ceiling is 0.

In a project other than the kit the rule compares comment lines per file with the call's start commit, so existing
comments are not a finding. `connectors: { comments-check: { rule: off } }` in the project's `agentbay.config.yaml`
turns it off.
