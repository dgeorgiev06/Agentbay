create table folders (
  folder text primary key,
  kind text not null check (kind in ('worktree', 'copy')),
  branch text,
  check ((kind = 'worktree') = (branch is not null))
);
