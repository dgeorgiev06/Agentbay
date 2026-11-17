# git-worktrees

The mode `git-worktrees` implements `worktrees@1`. It is the only mode that runs git. It makes a worktree and branch for each slice, says where a worktree stands, merges a slice's branch, sets a slice's work aside, and makes throwaway copies of commits and applies patches to them.

## Actions

| Action | What it does |
|---|---|
| `cut` | Makes the branch `forge/<slice>` and a worktree for it at `.forge/worktrees/<slice>`, at a base commit. Refused when the branch exists, when the folder exists and holds files, or when the slice is named `wip`. |
| `status` | Gives a worktree's head, the commits since a base with their subjects, whether it is clean, and its changed and untracked paths. |
| `changed` | Gives each path that differs between two commits: added, modified, deleted, or renamed and from where. |
| `copy` | Makes a copy of a commit's files at `.forge/copies/<name>`, with no `.git`, and links in it to paths git ignores in the project, such as `node_modules`. |
| `overlay` | Puts named paths into a copy as they are at a commit. A path absent there is removed. Never a worktree. |
| `remove` | Removes a copy, or a worktree with its branch when the worktree is clean and its branch is merged into a named branch and into the branch the project has checked out. Anything else is refused with a sentence. A folder the mode made that no longer exists is forgotten, and a worktree's branch is kept. |
| `merge` | Merges a clean slice's branch into a named branch with a merge commit. The merge is made in a worktree the mode checks out at `.forge/targets/<branch>` and removes after. A conflict is undone and refused with the conflicting paths. A branch already merged is answered as such, with no commit. |
| `set-aside` | Commits a worktree's changed and untracked files to a new branch `forge/wip/<slice>/<n>`, with `n` the first number no branch has, and puts the worktree back at its head with no changes. Ignored files stay. With nothing changed it does nothing and says so. |
| `apply` | Applies a patch to a copy, all of it or nothing, and gives the paths it names. Never a worktree. |

## What it refuses

- A slice or copy name that is not letters, digits and dashes; a commit with `..` or a leading dash; a path that is absolute, has `..`, or starts with a dash. The interface's schemas hold these rules, so the kernel refuses such a request before any step runs.
- A folder it did not make. Each folder it makes is recorded in its database; `status`, `overlay`, `remove`, `merge`, `set-aside` and `apply` look the folder up there, and say so when the folder is recorded but no longer exists.
- A repository whose own configuration names a filter or a merge driver. One named in `.git/info/attributes` would run its command, and the mode cannot switch it off by name.
- In `merge`: a slice with changed or untracked files, a branch that does not exist, and a branch checked out anywhere, the owner's checkout included. git checks out a branch in only one worktree, so the owner's checkout is never the one merged into.
- In `apply`: a patch naming a path that is absolute, has `..`, or is not letters, digits, dots, dashes and underscores in folders, before any command runs; a path whose attributes in the copy name a filter; and anything git itself refuses, such as a path beyond a link.

## How git is run

Every command starts with the same options, so no code from the repository runs:

| Option | Closes |
|---|---|
| `-c core.hooksPath=/dev/null` | every hook, such as `post-checkout`, `pre-commit`, `commit-msg`, `pre-merge-commit`, `post-merge` and `reference-transaction` |
| `-c core.fsmonitor=false` | a file-system monitor command |
| `-c submodule.recurse=false` | work in submodules, which have their own configuration |
| `--attr-source=<the empty tree>` | attributes in the repository's files, so no filter, diff driver or merge driver is chosen by them |

`apply` and `check-attr` run without `--attr-source`: git 2.43 crashes when `apply` is given it. A copy's own attributes are read instead, and `apply` refuses a path they give a filter.

Each listed prefix ends with `--end-of-options` or `--` where git allows it, so a script cannot add an option such as `--force` or `--output`. The kernel runs each command with only `PATH`, so git reads no user configuration.

`merge` and `commit` also get `-c user.name=agentbay-git-worktrees -c user.email=git-worktrees@agentbay.invalid`, so every commit the mode makes says it made it and no configuration of the owner's is read for it, and `-c gc.auto=0`, so no background clean-up starts. They add `--no-verify` and `--no-gpg-sign`, and `merge` adds `--no-verify-signatures`, so no signing program named in the repository's configuration runs. A commit message and a patch reach git on its standard input.

No command that changes files or the checked-out branch (`restore`, `switch`, `merge`, `add`, `commit`, `apply`) runs outside `.forge/`. One guard in `scripts/lib/git.ts` refuses it before it runs, so the owner's checkout, index and uncommitted work are never changed.

A throwaway copy is made by the kernel, which makes its folder under `.forge/copies/` (the mode's `resources.files.throwaway`), and filled by `git restore` with the copy as its work tree. The project's index is not changed.
