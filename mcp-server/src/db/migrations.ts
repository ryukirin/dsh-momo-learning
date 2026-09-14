import Database from 'better-sqlite3';

/**
 * Local mirror schema version recorded in `schema_migration` after a successful
 * migration.
 *
 * - Version 2 removed the `UNIQUE(... , upstream_order)` constraints that
 *   version 1 put on `today_item` and `todo_entry`.
 * - Version 3 normalized every stored date to 墨墨's calendar day.
 * - Version 4 made `study_record` one row per word — the mirror is the source a
 *   quiz is built from, so a word must never be duplicated by a later sync —
 *   and moved per-sync membership into `study_window_member`.
 * - Version 5 stored the day's first response, which is what narrows a quiz to
 *   the words the app already showed were not yet known.
 * - Version 6 added `quiz_mistake`, the only local record the quiz keeps: one row
 *   per word ever answered wrong, never a per-attempt transcript.
 */
export const schemaVersion = 6;

const schema = `
    CREATE TABLE IF NOT EXISTS schema_migration (version INTEGER PRIMARY KEY);
    CREATE TABLE IF NOT EXISTS mirror_sync (
      id TEXT PRIMARY KEY,
      scope_type TEXT NOT NULL CHECK(scope_type IN ('today_snapshot', 'study_record_window')),
      scope_key TEXT NOT NULL,
      requested_local_date TEXT,
      upstream_date_semantics TEXT NOT NULL,
      source_limit INTEGER NOT NULL,
      retrieved_count INTEGER NOT NULL,
      known_total INTEGER,
      read_range TEXT NOT NULL,
      completeness TEXT NOT NULL CHECK(completeness IN ('complete', 'partial', 'unknown')),
      outcome TEXT NOT NULL CHECK(outcome IN ('success', 'empty', 'failed')),
      error_class TEXT,
      started_at TEXT NOT NULL,
      finished_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS mirror_word (
      word_id TEXT PRIMARY KEY,
      spelling TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      plan_state TEXT NOT NULL DEFAULT 'current' CHECK(plan_state IN ('current', 'removed_from_current_plan')),
      plan_state_updated_at TEXT NOT NULL,
      latest_sync_id TEXT REFERENCES mirror_sync(id)
    );
    CREATE TABLE IF NOT EXISTS today_item (
      sync_id TEXT NOT NULL REFERENCES mirror_sync(id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES mirror_word(word_id),
      upstream_order INTEGER NOT NULL,
      is_new INTEGER,
      is_finished INTEGER,
      source_date TEXT NOT NULL,
      first_response TEXT,
      PRIMARY KEY(sync_id, word_id)
    );
    CREATE TABLE IF NOT EXISTS study_record (
      word_id TEXT PRIMARY KEY REFERENCES mirror_word(word_id),
      add_date TEXT,
      first_study_date TEXT,
      last_study_date TEXT,
      next_study_date TEXT,
      study_count INTEGER,
      tags TEXT,
      observed_at TEXT NOT NULL,
      latest_sync_id TEXT REFERENCES mirror_sync(id)
    );
    CREATE TABLE IF NOT EXISTS study_window_member (
      sync_id TEXT NOT NULL REFERENCES mirror_sync(id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES mirror_word(word_id),
      PRIMARY KEY(sync_id, word_id)
    );
    CREATE TABLE IF NOT EXISTS word_supplement (
      id TEXT PRIMARY KEY,
      word_id TEXT NOT NULL REFERENCES mirror_word(word_id),
      kind TEXT NOT NULL CHECK(kind IN ('interpretation', 'phrase', 'note')),
      content TEXT NOT NULL,
      translation TEXT,
      source TEXT NOT NULL CHECK(source = 'user_created'),
      updated_at TEXT,
      latest_sync_id TEXT REFERENCES mirror_sync(id)
    );
    CREATE TABLE IF NOT EXISTS capability_flag (
      name TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL,
      checked_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS todo_session (
      id TEXT PRIMARY KEY,
      source_sync_id TEXT NOT NULL REFERENCES mirror_sync(id),
      local_session_date TEXT NOT NULL,
      current_entry_id TEXT,
      paused_entry_id TEXT,
      status TEXT NOT NULL CHECK(status IN ('active', 'completed', 'abandoned')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS todo_entry (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES todo_session(id) ON DELETE CASCADE,
      upstream_order INTEGER NOT NULL,
      word_id TEXT NOT NULL REFERENCES mirror_word(word_id),
      status TEXT NOT NULL CHECK(status IN ('pending', 'understood', 'skipped', 'paused')),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quiz_mistake (
      word_id TEXT PRIMARY KEY REFERENCES mirror_word(word_id),
      spelling TEXT NOT NULL,
      first_missed_day TEXT NOT NULL,
      last_missed_day TEXT NOT NULL,
      miss_count INTEGER NOT NULL,
      last_prompt TEXT,
      last_type TEXT,
      cleared_day TEXT
    );
  `;

/**
 * Indexes, created after every table rebuild rather than with the tables.
 *
 * SQLite keeps a table's indexes attached across `ALTER TABLE ... RENAME`, so an
 * index created before the version-4 collapse would follow the old table to its
 * temporary name and then disappear with it, leaving the rebuilt table
 * unindexed while `IF NOT EXISTS` reported success.
 */
const indexes = `
    CREATE INDEX IF NOT EXISTS idx_mirror_sync_scope ON mirror_sync(scope_key, finished_at DESC);
    CREATE INDEX IF NOT EXISTS idx_study_record_last ON study_record(last_study_date);
    CREATE INDEX IF NOT EXISTS idx_study_record_next ON study_record(next_study_date);
    CREATE INDEX IF NOT EXISTS idx_quiz_mistake_last ON quiz_mistake(last_missed_day);
  `;

/**
 * Tables whose version-1 shape carried a `UNIQUE` constraint on
 * `upstream_order`, with the column list used to copy their rows across the
 * rebuild. Every column of the version-1 table is listed, so no stored row and
 * no field is dropped.
 */
const orderConstraintRebuilds = [
  { table: 'today_item', columns: 'sync_id,word_id,upstream_order,is_new,is_finished,source_date' },
  { table: 'todo_entry', columns: 'id,session_id,upstream_order,word_id,status,updated_at' }
] as const;

/** Column names of one stored table, or an empty list when it does not exist. */
const tableColumns = (db: Database.Database, table: string): string[] => {
  const exists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { name?: string } | undefined;
  if (exists === undefined) return [];
  return (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name);
};

const storedTableSql = (db: Database.Database, table: string): string => {
  const row = db
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?")
    .get(table) as { sql?: string } | undefined;
  return row?.sql ?? '';
};

/**
 * Return whether a table still declares a uniqueness rule on its `upstream_order`.
 *
 * `/memo/study/get_today_items` publishes `order` as the study sequence, not as
 * an identity: one real day returned 150 items across 135 distinct orders. The
 * version-1 constraint therefore rejected valid upstream data, so the current
 * schema keys today's items and todo entries by word instead.
 * @param db - the open database.
 * @param table - table to inspect.
 * @returns whether the stored DDL still contains that constraint.
 */
const hasUniqueUpstreamOrder = (db: Database.Database, table: string): boolean =>
  /UNIQUE\s*\([^)]*upstream_order[^)]*\)/i.test(storedTableSql(db, table));

/** Recreate one table without its version-1 `upstream_order` uniqueness rule, keeping every row. */
const rebuildWithoutUniqueUpstreamOrder = (
  db: Database.Database,
  table: string,
  columns: string
): void => {
  if (!hasUniqueUpstreamOrder(db, table)) return;
  const previous = `${table}_previous`;
  // `PRAGMA foreign_keys` is a no-op inside a transaction, so it is toggled
  // around the rebuild — the documented SQLite procedure for this change.
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec(`ALTER TABLE ${table} RENAME TO ${previous}`);
      db.exec(schema);
      db.exec(`INSERT INTO ${table} (${columns}) SELECT ${columns} FROM ${previous}`);
      db.exec(`DROP TABLE ${previous}`);
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
};

/**
 * Collapse a version-3 `study_record` — one row per sync and word — into the
 * current one row per word.
 *
 * The row kept for each word is the one observed by the most recent sync, so the
 * collapsed state equals what the last successful read reported. The per-sync
 * membership that the version-3 removal rule compared against is preserved in
 * `study_window_member`, so an existing mirror keeps its ability to mark a word
 * as no longer planned.
 */
const collapseStudyRecordToPerWord = (db: Database.Database): void => {
  if (!tableColumns(db, 'study_record').includes('sync_id')) return;
  db.pragma('foreign_keys = OFF');
  try {
    db.transaction(() => {
      db.exec('ALTER TABLE study_record RENAME TO study_record_previous');
      db.exec(schema);
      db.exec(`
        INSERT INTO study_window_member(sync_id, word_id)
        SELECT sync_id, word_id FROM study_record_previous
      `);
      db.exec(`
        INSERT INTO study_record(
          word_id, add_date, first_study_date, last_study_date, next_study_date,
          study_count, tags, observed_at, latest_sync_id
        )
        SELECT
          previous.word_id, previous.add_date, previous.first_study_date,
          previous.last_study_date, previous.next_study_date, previous.study_count,
          previous.tags, COALESCE(sync.finished_at, ''), previous.sync_id
        FROM study_record_previous previous
        LEFT JOIN mirror_sync sync ON sync.id = previous.sync_id
        WHERE previous.rowid = (
          SELECT candidate.rowid
          FROM study_record_previous candidate
          LEFT JOIN mirror_sync candidate_sync ON candidate_sync.id = candidate.sync_id
          WHERE candidate.word_id = previous.word_id
          ORDER BY candidate_sync.finished_at DESC, candidate.rowid DESC
          LIMIT 1
        )
      `);
      db.exec('DROP TABLE study_record_previous');
    })();
  } finally {
    db.pragma('foreign_keys = ON');
  }
};

/**
 * Add the day's first response to stored today items when an older schema lacks it.
 *
 * A nullable column appended by `ALTER TABLE` sits in the same position the
 * current DDL gives it, so existing positional inserts keep working unchanged.
 */
const addTodayResponseColumn = (db: Database.Database): void => {
  if (tableColumns(db, 'today_item').includes('first_response')) return;
  db.exec('ALTER TABLE today_item ADD COLUMN first_response TEXT');
};

/** Columns of `study_record` holding dates upstream publishes as instants. */const studyDateColumns = [
  'add_date',
  'first_study_date',
  'last_study_date',
  'next_study_date'
] as const;

/**
 * The Beijing calendar day of the sync that produced a snapshot row.
 * @param alias - table alias prefix, `''` or `'m.'`.
 * @returns the SQL expression.
 */
const beijingDayOfSync = (alias = ''): string => `date(${alias}finished_at, '+8 hours')`;

/**
 * Normalize every stored date to 墨墨's calendar day.
 *
 * Upstream writes Beijing midnight as a UTC instant, so
 * `2026-09-12T16:00:00.000Z` is Beijing 2026-09-13 — storing it verbatim made
 * `substr(value, 1, 10)` name the previous day. The conversion is idempotent for
 * values that are already calendar days, so re-running it changes nothing.
 */
const normalizeStoredDatesToBeijingDays = (db: Database.Database): void => {
  for (const column of studyDateColumns) {
    // `date()` returns NULL for an unparseable value, so the guard keeps such a
    // value as it was instead of erasing it.
    db.prepare(
      `UPDATE study_record SET ${column} = date(${column}, '+8 hours')
       WHERE ${column} LIKE '%T%' AND date(${column}, '+8 hours') IS NOT NULL`
    ).run();
  }
  // A snapshot's day is the Beijing day of the sync that fetched it — the only
  // instant a stored row still carries. The caller's `requested_local_date`
  // stays untouched: it records what the caller named, not what upstream scoped to.
  db.prepare(
    `UPDATE mirror_sync SET scope_key = 'today:' || ${beijingDayOfSync()}
     WHERE scope_type = 'today_snapshot'
       AND ${beijingDayOfSync()} IS NOT NULL
       AND scope_key <> 'today:' || ${beijingDayOfSync()}`
  ).run();
  db.prepare(
    `UPDATE today_item SET source_date = (
       SELECT ${beijingDayOfSync('m.')} FROM mirror_sync m WHERE m.id = today_item.sync_id
     )
     WHERE (SELECT ${beijingDayOfSync('m.')} FROM mirror_sync m WHERE m.id = today_item.sync_id) IS NOT NULL
       AND source_date <> (
         SELECT ${beijingDayOfSync('m.')} FROM mirror_sync m WHERE m.id = today_item.sync_id
       )`
  ).run();
};

export const migrate = (db: Database.Database): void => {
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 3000');
  db.exec(schema);
  for (const rebuild of orderConstraintRebuilds) {
    rebuildWithoutUniqueUpstreamOrder(db, rebuild.table, rebuild.columns);
  }
  collapseStudyRecordToPerWord(db);
  addTodayResponseColumn(db);
  db.exec(indexes);
  normalizeStoredDatesToBeijingDays(db);
  db.prepare(
    'INSERT INTO schema_migration(version) VALUES(?) ON CONFLICT(version) DO NOTHING'
  ).run(schemaVersion);
};
