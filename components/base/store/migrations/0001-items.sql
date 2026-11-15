create table items (
  id text primary key,
  kind text not null,
  source text not null,
  at text not null,
  at_ms integer not null,
  title text,
  text text not null,
  url text,
  author text,
  labels text not null,
  data text not null,
  stored_at text not null
);

create index items_by_time on items (at_ms, id);

create index items_by_source on items (source, at_ms);

create virtual table items_search using fts5 (title, text, author, content = 'items', content_rowid = 'rowid');

create trigger items_search_insert after insert on items begin
  insert into items_search (rowid, title, text, author) values (new.rowid, new.title, new.text, new.author);
end;

create trigger items_search_delete after delete on items begin
  insert into items_search (items_search, rowid, title, text, author)
    values ('delete', old.rowid, old.title, old.text, old.author);
end;

create trigger items_search_update after update on items begin
  insert into items_search (items_search, rowid, title, text, author)
    values ('delete', old.rowid, old.title, old.text, old.author);
  insert into items_search (rowid, title, text, author) values (new.rowid, new.title, new.text, new.author);
end;

create table deletions (
  id text primary key,
  deleted_at text not null
);

create table sync_state (
  source text primary key,
  kinds text not null,
  cursor text,
  last_sync text,
  selector text
);

create table spend (
  page text primary key,
  source text not null,
  month text not null,
  items integer not null,
  usd real not null,
  recorded_at text not null
);

create view items_view as
  select id, kind, source, at, title, text, url, author, labels, data from items;

create view spend_by_month as
  select source, month, sum(items) as items, sum(usd) as usd from spend group by source, month;
