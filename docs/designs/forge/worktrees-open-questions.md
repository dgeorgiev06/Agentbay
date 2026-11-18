# `worktrees@1`: what the interface leaves undefined

Found while writing its shared test (slice S2). A second implementation would trip on each. Question 12 is answered; the others are not. The first is the one that matters before forge is built.

1. **Where the interface's meaning lives.** `worktrees.yaml` has no descriptions of its actions. That `apply` is all or nothing, that a conflict is refused and names its paths, that only a clean worktree is removed, that an existing branch is refused, and that the owner's checkout is left alone are all written only in the git-worktrees mode's README or manifest. The shared test now states them; should the interface's own file carry them too?
2. **The order of `changed`.** "The order git gives them" means nothing to another implementation. The shared test compares sorted by path.
3. **When a path is "renamed".** Git guesses by similarity. The shared test asserts only an exact move.
4. **"Ignored by git".** These are git's words in two schemas. A second implementation has to invent what ignored means.
5. **Where folders may be.** The interface gives only `.forge/…` examples.
6. **Whether "merged into the branch the project has checked out" is part of `remove`.** It is a rule of git's own. The shared test does not state it.
7. **History that is not a straight line.** "Commits since the base, oldest first" is undefined once there are merge commits.
8. **The slice name `wip`.** It clashes with git's naming of branches, not with the interface.
9. **Whether `status` may look at a copy.**
10. **`remove`'s `into` may be a commit hash.** What "merged into" a hash means is not said.
11. **`bay check` counts a type-only import of a shared test as running it.** The builders worked round it in tests; the check itself is unchanged.
12. **What a copy is.** Answered by slice WT1. A copy's folder is the top of a repository of its own that holds the commit's files as one commit; the links are present and ignored there; nothing done inside it changes the project's repository. `copy-response` says so, and `overlay-response` and `apply-response` say each change is one more commit of the copy, so the copy stays clean. The shared test asks each mode for its own tool that lists a folder's files (`listed`), so its words name no git. The made-up `shelf` passes by giving each copy a shelf of its own.
13. **How a second worktrees mode keeps a copy's links out of its listing.** git reads `.git/info/exclude`; the shelf reads its own `.shelf/ignored`. The interface says only that links are ignored, not by what.
14. **Whether a copy may share the project's objects.** The git-worktrees mode copies every file into the copy's own store: about 5.5 MB and one second more for a copy of the kit. Sharing objects (alternates) would be cheaper, but then a clean-up in the project could remove what a copy needs.
