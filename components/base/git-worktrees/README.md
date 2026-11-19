# git-worktrees

The mode `git-worktrees` implements `worktrees@1`. It is the only mode that runs git. It makes a worktree and branch for each slice, says where a worktree stands, commits a slice's work to its branch, merges a slice's branch, sets a slice's work aside, and makes throwaway copies of commits and applies patches to them.

## Actions

| Action | What it does |
|---|---|
| `cut` | Makes the branch `forge/<slice>` and a worktree for it at `.forge/worktrees/<slice>`, at a base commit. Refused when the branch exists, when the folder exists and holds files, or when the slice is named `wip`. |
| `status` | Gives a worktree's head, the commits since a base with their subjects, whether it is clean, and its changed and untracked paths. |
| `changed` | Gives each path that differs between two commits: added, modified, deleted, or renamed and from where. |
| `copy` | Makes a copy of a commit's files at `.forge/copies/<name>`. The folder is the top of a repository of its own that holds the commit's files as one commit, and it is clean. It has links to paths git ignores in the project, such as `node_modules`, and lists them in its own `.git/info/exclude`, so they are present and ignored. Nothing done inside the copy changes the project's repository. |
| `overlay` | Puts named paths into a copy as they are at a commit. A path absent there is removed. The change is one more commit of the copy's repository, so the copy stays clean. Never a worktree. |
| `remove` | Removes a copy, or a worktree with its branch when the worktree is clean and its branch is merged into a named branch and into the branch the project has checked out. Anything else is refused with a sentence. A folder the mode made that no longer exists is forgotten, and a worktree's branch is kept. |
| `merge` | Merges a clean slice's branch into a named branch with a merge commit. The merge is made in a worktree the mode checks out at `.forge/targets/<branch>` and removes after. A conflict is undone and refused with the conflicting paths. A branch already merged is answered as such, with no commit. |
| `set-aside` | Commits a worktree's changed and untracked files to a new branch `forge/wip/<slice>/<n>`, with `n` the first number no branch has, and puts the worktree back at its head with no changes. Ignored files stay. With nothing changed it does nothing and says so. |
| `commit` | Commits a worktree's changed and untracked files to its own branch `forge/<slice>`, with the message the caller gives, and the files stay in the worktree, which is then clean. Ignored files stay out of the commit and in the worktree. A link is committed as a link; git never follows it. With nothing changed it makes no commit and gives the branch's head. Refused when the worktree's head is not its branch's head. |
| `apply` | Applies a patch to a copy, all of it or nothing, and gives the paths it names. The change is one more commit of the copy's repository, so the copy stays clean. Never a worktree. |

## What it refuses

- A slice or copy name that is not letters, digits and dashes; a commit with `..` or a leading dash; a path that is absolute, has `..`, or starts with a dash. The interface's schemas hold these rules, so the kernel refuses such a request before any step runs.
- A folder it did not make. Each folder it makes is recorded in its database; `status`, `overlay`, `remove`, `merge`, `set-aside`, `commit` and `apply` look the folder up there, and say so when the folder is recorded but no longer exists.
- A copy that is no longer the top of a repository of its own, such as one whose `.git` was removed or now points at another repository. `overlay` and `apply` check this before git changes anything in it, so a tool run in the copy cannot make the mode write to the project's repository.
- A repository whose own configuration names a filter or a merge driver, and a copy whose own configuration names one. One named in `.git/info/attributes` would run its command, and the mode cannot switch it off by name.
- In `merge`: a slice with changed or untracked files, a branch that does not exist, and a branch checked out anywhere, the owner's checkout included. git checks out a branch in only one worktree, so the owner's checkout is never the one merged into.
- In `commit`: a worktree whose head is not its branch's head, such as one switched to another commit by hand. A worktree on another branch, or on none, at its branch's head is switched back to its branch first, so the commit is always on `forge/<slice>`.
- In `apply`: a patch naming a path that is absolute, has `..`, or is not letters, digits, dots, dashes and underscores in folders, before any command runs; a path whose attributes in the copy name a filter; and anything git itself refuses, such as a path beyond a link.

## How git is run

Every command runs git with these options, so no code from the repository runs:

| Option | Closes |
|---|---|
| `-c core.hooksPath=/dev/null` | every hook, such as `post-checkout`, `pre-commit`, `commit-msg`, `pre-merge-commit`, `post-merge` and `reference-transaction` |
| `-c core.fsmonitor=false` | a file-system monitor command |
| `-c submodule.recurse=false` | work in submodules, which have their own configuration |
| `--attr-source=<the empty tree>` | attributes in the repository's files, so no filter, diff driver or merge driver is chosen by them |

The manifest states the first three once, in `resources.commandsStartWith`, and every listed command starts with them. `--attr-source` is written in each command's own words, because two commands leave it out: `apply` and `check-attr` run without it, since git 2.43 crashes when `apply` is given it. A copy's own attributes are read instead, and `apply` refuses a path they give a filter. A test of the mode, `tests/listed-commands.test.ts`, reads the full words of every listed command from `bay check` and fails if one lacks an option it must carry.

The words of each listed command end with `--end-of-options` or `--` where git allows it, so an argument a script adds cannot be an option such as `--force` or `--output`. Four commands end otherwise. `repository-top` ends with `--show-toplevel`, since `rev-parse` prints `--end-of-options` back, and it only reads. `repository-filters` ends with its pattern, and git reads every later argument as a value pattern. `abort-merge` ends with `--abort`, and git refuses any later argument. `restore-paths` ends with `--source`, so a script's first argument is the commit and git reads a later argument that starts with a dash as an option. The kernel runs each command with only `PATH`, so git reads no user configuration. git still reads the system's configuration, such as `/etc/gitconfig`. The options above override each setting there that could run a hook, a watcher, a template or a signing program for the commands the mode runs.

`changes` runs `status` with `--no-optional-locks`, so it does not rewrite the index. `changed-paths` runs `diff-tree`, which compares two commits and never reads or writes the index.

`merge` and `commit` also get `-c user.name=agentbay-git-worktrees -c user.email=git-worktrees@agentbay.invalid`, so every commit the mode makes says it made it and no configuration of the owner's is read for it, and `-c gc.auto=0`, so no background clean-up starts. They add `--no-verify` and `--no-gpg-sign`, and `merge` adds `--no-verify-signatures`, so no signing program named in the repository's configuration runs. A commit message and a patch reach git on its standard input. The action `commit` gives git the caller's message with a newline after it. git then removes spaces at the ends of lines, blank lines at the start and end, and repeated blank lines; a line that starts with `#` stays. A repository whose configuration sets `commit.cleanup`, such as to `strip`, changes this, and the mode does not refuse it. `commit` adds `--allow-empty`, so an `overlay` that changes nothing still records itself in a copy. The commit that makes a copy says `A throwaway copy of <commit>.`, so its identity and its message say a copy was made.

No command that changes files or the checked-out branch (`restore`, `switch`, `merge`, `add`, `commit`, `apply`) runs outside `.forge/`. One guard in `scripts/lib/git.ts` refuses it before it runs, so the owner's checkout, index and uncommitted work are never changed.

A throwaway copy is made in five steps. The kernel makes its folder under `.forge/copies/` (the mode's `resources.files.throwaway`). `make-repository` runs `git init` in it with no template, so no hook or other file of a template reaches it. `restore-paths` fills it from the project's repository: it runs in the copy with `--git-dir=../../../.git`, the project's repository three folders up, and `--work-tree=.`, the copy, and changes no index. It adds `-c core.autocrlf=false`, so the project's own line-end setting does not rewrite the files on the way out. `forget-paths`, `stage-paths` and `commit-staged` record the files as the copy's one commit, and unless that commit's tree is the commit's tree the copy is removed and refused. Attributes in the project's own `.git/info/attributes`, such as `* text eol=crlf`, can still change the bytes, and that is what the refusal catches. Last the kernel makes the links and the folder `.git/info`, and `apply-patch`, run in that folder, writes `exclude` with one line per link. The mode's scripts never write a file in a throwaway folder, and `git apply` is the one git command that writes a file the mode chooses.

The copy's repository is not a worktree and not a clone. It has no remote, no alternates and no refs of the project, so nothing done inside it, such as a commit, a branch, a reset or `git clean`, reaches the project's branches, index, objects or worktrees. `remove` deletes the folder with its `.git`, and nothing is left in the project's repository.

`overlay` and `apply` record what they change in the same way: `forget-paths` takes the named paths out of the copy's index, `untracked-paths` says which of them are now in the copy, `stage-paths` adds those, and `commit-staged` commits. So the copy is clean after each, and `git ls-files` lists exactly its files. Before that, `repository-top` must say that the copy is the top of its own repository: no prefix, and a git folder that is the copy's own `.git`.

## Effects

Each listed command says the effects it can have with any arguments a script adds after its words, not only with the ones the mode's scripts pass. Each action declares the effects of every command its script can run and of every other thing it asks the kernel for. These are the mode's claims: `bay check` shows each one to the owner, and the kernel believes them and cannot check them.

| Action | Effects | Why |
|---|---|---|
| `status`, `changed` | read | They run only commands that read. |
| `cut` | read, write, delete | It runs `switch-branch`. |
| `remove`, `merge`, `set-aside`, `commit`, `apply` | read, write, delete | They remove worktrees, branches, files or rows of the mode's database. |
| `copy`, `overlay` | read, write, network, spend, delete | They run `restore-paths`. |

| Command | Effects | Why |
|---|---|---|
| `commit-of`, `repository-filters`, `changes`, `commits-between`, `changed-paths`, `is-ignored`, `paths-at-commit`, `untracked-paths`, `is-ancestor`, `filters-of-paths`, `repository-top` | read | git only reads the repository and the files. |
| `add-detached-worktree`, `add-worktree`, `make-branch` | read, write | They make a folder and files, or a branch. Without `--force` they refuse to replace one. |
| `make-repository` | read, write | It makes a repository in a folder, or in a folder a script names after its words. On a repository that exists it changes nothing but writes its configuration again. |
| `switch-branch`, `merge-branch`, `abort-merge`, `apply-patch` | read, write, delete | They can remove files from a worktree or a copy. |
| `remove-worktree`, `delete-branch` | read, write, delete | They remove a worktree or a branch. |
| `stage-everything`, `stage-paths`, `forget-paths`, `commit-staged` | read, write, delete | They can remove entries from the index. |
| `restore-paths` | read, write, network, spend, delete | A script can add an option after the commit. `--staged` writes the project's index, and `--recurse-submodules` runs git in each submodule, where a filter named in the submodule's own configuration can run any program. |

In a partial clone git fetches a missing object from the clone's remote when a command needs it, whatever its words. The effects above do not cover that, and the mode does not refuse a partial clone.
