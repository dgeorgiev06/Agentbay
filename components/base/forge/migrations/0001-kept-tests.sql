create table kept_tests (
  slice text not null,
  path text not null,
  packed text not null,
  primary key (slice, path)
);
