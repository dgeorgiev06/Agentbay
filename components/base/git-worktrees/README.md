# git-worktrees

The mode `git-worktrees` implements `worktrees@1`. It is the only mode that runs git. It makes a worktree and branch for each slice, says where a worktree stands, and makes throwaway copies of commits.

## Actions

| Action | What it does |
|---|---|
| `cut` | Makes the branch `forge/<slice>` and a worktree for it at `.forge/worktrees/<slice>`, at a base commit. Refused when the branch exists, or when the folder exists and holds files. |
| `status` | Gives a worktree's head, the commits since a base with their subjects, whether it is clean, and its changed and untracked paths. |
| `changed` | Gives each path that differs between two commits: added, modified, deleted, or renamed and from where. |
| `copy` | Makes a copy of a commit's files at `.forge/copies/<name>`, with no `.git`, and links in it to paths git ignores in the project, such as `node_modules`. |
| `overlay` | Puts named paths into a copy as they are at a commit. A path absent there is removed. Never a worktree. |
| `remove` | Removes a copy, or a worktree with its branch when the worktree is clean and its branch is merged into a named branch and into the branch the project has checked out. Anything else is refused with a sentence. |

## What it refuses

- A slice or copy name that is not letters, digits and dashes; a commit with `..` or a leading dash; a path that is absolute, has `..`, or starts with a dash. The interface's schemas hold these rules, so the kernel refuses such a request before any step runs.
- A folder it did not make. Each folder it makes is recorded in its database; `status`, `overlay` and `remove` look the folder up there.
- A repository whose own configuration names a filter. A filter named in `.git/info/attributes` would run its command, and the mode cannot switch it off by name.

## How git is run

Every command starts with the same options, so no code from the repository runs:

| Option | Closes |
|---|---|
| `-c core.hooksPath=/dev/null` | every hook, such as `post-checkout` and `reference-transaction` |
| `-c core.fsmonitor=false` | a file-system monitor command |
| `-c submodule.recurse=false` | work in submodules, which have their own configuration |
| `--attr-source=<the empty tree>` | attributes in the repository's files, so no filter, diff driver or merge driver is chosen by them |

Each listed prefix ends with `--end-of-options` where git allows it, so a script cannot add an option such as `--force` or `--output`. The kernel runs each command with only `PATH`, so git reads no user configuration.

A throwaway copy is made by the kernel, which makes its folder under `.forge/copies/` (the mode's `resources.files.throwaway`), and filled by `git restore` with the copy as its work tree. The project's index is not changed.
