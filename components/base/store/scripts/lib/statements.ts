export const selectExistingIds = "select id from items where id in (select value from json_each(:ids))";

export const selectDeletedIds = "select id from deletions where id in (select value from json_each(:ids))";

export const selectKindsOfOtherSources = "select source, kinds from sync_state where source != :source";

export const recordSpend = `insert or ignore into spend (page, source, month, items, usd, recorded_at)
  values (:page, :source, :month, :items, :usd, :recorded_at)`;

export const upsertItem = `insert into items
    (id, kind, source, at, at_ms, title, text, url, author, labels, data, stored_at)
  values (:id, :kind, :source, :at, :at_ms, :title, :text, :url, :author, :labels, :data, :stored_at)
  on conflict (id) do update set
    kind = excluded.kind,
    at = excluded.at,
    at_ms = excluded.at_ms,
    title = excluded.title,
    text = excluded.text,
    url = excluded.url,
    author = excluded.author,
    labels = excluded.labels,
    data = excluded.data,
    stored_at = excluded.stored_at`;

export const upsertSyncState = `insert into sync_state (source, kinds, cursor, last_sync, selector)
  values (:source, :kinds, :cursor, :last_sync, :selector)
  on conflict (source) do update set
    kinds = excluded.kinds,
    cursor = case when :keep_cursor then sync_state.cursor else excluded.cursor end,
    last_sync = excluded.last_sync,
    selector = coalesce(excluded.selector, sync_state.selector)`;

const itemColumns = "id, kind, source, at, title, text, url, author, labels, data";

export const selectItemsByIds = `select ${itemColumns} from items where id in (select value from json_each(:ids))`;

export const selectItemById = `select ${itemColumns} from items where id = :id`;

const queryFilter = `from items
  where (:since is null or at_ms >= :since)
    and (:until is null or at_ms < :until)
    and (:kinds is null or kind in (select value from json_each(:kinds)))
    and (:search is null or rowid in (select rowid from items_search where items_search match :search))`;

export const queryNewestFirst = `select ${itemColumns} ${queryFilter} order by at_ms desc, id desc`;

export const queryOldestFirst = `select ${itemColumns} ${queryFilter} order by at_ms asc, id asc`;

export const deleteItem = "delete from items where id = :id";

export const rememberDeletion = "insert or ignore into deletions (id, deleted_at) values (:id, :deleted_at)";

export const pruneItems = "delete from items where source != 'local' and at_ms < :before";

export const countItems = "select count(*) as count from items";

export const countDeletions = "select count(*) as count from deletions";

export const selectSources = `select sync_state.source, sync_state.kinds, sync_state.cursor, sync_state.last_sync,
    sync_state.selector, (select count(*) from items where items.source = sync_state.source) as items
  from sync_state order by sync_state.source`;

export const selectSpend = "select source, month, items, usd from spend_by_month order by source, month";

export const selectMonthSpend =
  "select coalesce(sum(usd), 0) as usd from spend where source = :source and month = :month";
