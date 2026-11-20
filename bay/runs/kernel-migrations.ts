export const migrations: readonly string[] = [
  `create table runs (
    id text primary key,
    target_kind text not null check (target_kind in ('action', 'workflow')),
    target_mode text not null,
    target_name text not null,
    input text not null,
    status text not null check (status in ('running', 'waiting', 'done', 'failed', 'undone')),
    waiting_reason text check (waiting_reason in ('skill', 'approval', 'time', 'budget', 'owner')),
    waiting_step text,
    waiting_until text,
    output text,
    reason text,
    limits text not null,
    extra text not null,
    spent text not null,
    stop_reason text,
    lock_owner text,
    lock_heartbeat text,
    created_at text not null,
    updated_at text not null
  );
  create index runs_by_status on runs (status, created_at);
  create table steps (
    run_id text not null references runs (id),
    key text not null,
    kind text not null,
    status text not null check (status in ('started', 'done', 'failed')),
    input text not null,
    output text,
    reason text,
    detail text not null,
    spent text not null,
    finish_order integer,
    started_at text not null,
    finished_at text,
    primary key (run_id, key)
  );
  create table events (
    id integer primary key autoincrement,
    run_id text not null,
    at text not null,
    kind text not null,
    detail text not null
  );
  create index events_by_run on events (run_id, id);`,
  `create table task_tokens (
    hash text primary key,
    run_id text not null references runs (id),
    step_key text not null,
    round integer not null,
    issued_at text not null
  );
  create index task_tokens_by_run on task_tokens (run_id);`,
  "alter table runs add column target_caller text;",
  `alter table runs add column kept text not null default 'as-text' check (kept in ('as-text', 'kept-packed'));
  alter table steps add column kept text not null default 'as-text' check (kept in ('as-text', 'kept-packed'));`,
];
