# requirements

The mode `requirements` implements `requirements@1`. Its one action, `check`, reads a requirements file under `docs/requirements/` and answers accepted or refused. Accepted hands back what the file holds, its outcomes and conditions with their ids, as data. Refused names every problem at once, each with its line in the file, its rule and a sentence that says what to write instead. It uses no model, runs no command and writes nothing.

The file's form is the interface's: `$defs/requirements` in `check-response.json`. The check holds the rules a schema cannot: a literal value in each `then` and in each refused condition's `after`, which a refused condition must have; no vague word and no date that moves, from the lists in `scripts/lib/words.ts`, among the condition's own words: a value in double quotes is the owner's data, so "buy some milk" or "call now" may stay, and only the words outside the quotes are looked at; a refused condition or a `noRefusal` for each outcome; ids used once, each condition's starting with its outcome's, and a removed id never used again; one `changes` entry per version, the current one naming only conditions the file has, and version 1 adding exactly its conditions; an open question recommending one of its answers; and a job named as its file. A value the form refuses is not refused again by a rule.

What it does not hold yet: that `version` is the last signed version plus one, and that a later version's `changes` match the difference from the version before. Both need that version, which the check is not given.

Forge brings this mode, bound to `requirements@1`, when the config binds no mode to `requirements`.
