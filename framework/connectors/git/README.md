# git (framework connector)

Implements `session.events/v1` for the improve mode, in env `improve-local`: the project's commits as session
episodes (sha, date, revert flag, files and churn). Commit messages are read only to detect reverts and are
never returned. Read-only.
