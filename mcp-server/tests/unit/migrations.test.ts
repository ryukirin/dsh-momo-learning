import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrations.js';
import { removeDatabaseSidecars } from '../../src/db/local-data-clearer.js';

test('迁移创建受约束的本地表', () => {
  const db = new Database(':memory:');
  migrate(db);
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as {
    name: string;
  }[];
  assert.equal(
    tables.some((row) => row.name === 'mirror_sync'),
    true
  );
  assert.throws(() =>
    db
      .prepare(
        "INSERT INTO mirror_sync VALUES('x','today_snapshot','x',NULL,'x',1,0,NULL,'x','bad','success',NULL,'x','x')"
      )
      .run()
  );
  db.close();
});

test('迁移把带 upstream_order 唯一约束的旧表重建为按词去重，并保留既有行', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE mirror_sync (
      id TEXT PRIMARY KEY, scope_type TEXT NOT NULL, scope_key TEXT NOT NULL,
      requested_local_date TEXT, upstream_date_semantics TEXT NOT NULL, source_limit INTEGER NOT NULL,
      retrieved_count INTEGER NOT NULL, known_total INTEGER, read_range TEXT NOT NULL,
      completeness TEXT NOT NULL, outcome TEXT NOT NULL, error_class TEXT,
      started_at TEXT NOT NULL, finished_at TEXT NOT NULL
    );
    CREATE TABLE mirror_word (
      word_id TEXT PRIMARY KEY, spelling TEXT NOT NULL, first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL, plan_state TEXT NOT NULL DEFAULT 'current',
      plan_state_updated_at TEXT NOT NULL, latest_sync_id TEXT REFERENCES mirror_sync(id)
    );
    CREATE TABLE today_item (
      sync_id TEXT NOT NULL REFERENCES mirror_sync(id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES mirror_word(word_id), upstream_order INTEGER NOT NULL,
      is_new INTEGER, is_finished INTEGER, source_date TEXT NOT NULL,
      PRIMARY KEY(sync_id, word_id), UNIQUE(sync_id, upstream_order)
    );
    CREATE TABLE todo_session (
      id TEXT PRIMARY KEY, source_sync_id TEXT NOT NULL REFERENCES mirror_sync(id),
      local_session_date TEXT NOT NULL, current_entry_id TEXT, paused_entry_id TEXT,
      status TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE todo_entry (
      id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES todo_session(id) ON DELETE CASCADE,
      upstream_order INTEGER NOT NULL, word_id TEXT NOT NULL REFERENCES mirror_word(word_id),
      status TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(session_id, upstream_order)
    );
    CREATE TABLE study_record (
      sync_id TEXT NOT NULL REFERENCES mirror_sync(id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES mirror_word(word_id), add_date TEXT, first_study_date TEXT,
      last_study_date TEXT, next_study_date TEXT, study_count INTEGER, tags TEXT,
      PRIMARY KEY(sync_id, word_id)
    );
    -- The version-1 shape: a day keyed by the caller's local date, an
    -- unparseable instant, and study dates stored as the raw UTC instants
    -- upstream publishes. All three are what version 3 normalizes.
    INSERT INTO mirror_sync VALUES('s1','today_snapshot','today:2026-09-12','2026-09-12','墨墨当天项目',1000,1,NULL,'范围','unknown','success',NULL,'t','2026-09-13T09:43:21.518Z');
    INSERT INTO mirror_word VALUES('w1','alpha','t','t','current','t','s1');
    INSERT INTO today_item VALUES('s1','w1',10,0,1,'2026-09-12');
    INSERT INTO study_record VALUES('s1','w1','2026-08-31T16:00:00.000Z','2026-08-31T16:00:00.000Z','2026-09-12T16:00:00.000Z','2026-09-15T16:00:00.000Z',3,'["STICKING"]');
  `);
  db.prepare("INSERT INTO mirror_word VALUES('w2','beta','t','t','current','t','s1')").run();
  assert.throws(
    () => db.prepare("INSERT INTO today_item VALUES('s1','w2',10,0,1,'2026-09-13')").run(),
    /UNIQUE/
  );

  migrate(db);

  assert.deepEqual(db.prepare('SELECT * FROM today_item').all(), [
    {
      sync_id: 's1',
      word_id: 'w1',
      upstream_order: 10,
      is_new: 0,
      is_finished: 1,
      source_date: '2026-09-13',
      first_response: null
    }
  ]);
  // The snapshot's day becomes the Beijing day of the sync that fetched it,
  // while the date the caller named is kept as the caller's own record.
  assert.deepEqual(db.prepare('SELECT scope_key, requested_local_date FROM mirror_sync').get(), {
    scope_key: 'today:2026-09-13',
    requested_local_date: '2026-09-12'
  });
  // Upstream's Beijing-midnight instants become Beijing calendar days.
  assert.deepEqual(
    db
      .prepare(
        'SELECT first_study_date, last_study_date, next_study_date, study_count, tags FROM study_record'
      )
      .get(),
    {
      first_study_date: '2026-09-01',
      last_study_date: '2026-09-13',
      next_study_date: '2026-09-16',
      study_count: 3,
      tags: '["STICKING"]'
    }
  );
  // The rebuilt table carries the response column, so a row supplies it too.
  db.prepare("INSERT INTO today_item VALUES('s1','w2',10,0,1,'2026-09-13',NULL)").run();
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS count FROM today_item').get() as { count: number }).count,
    2
  );
  // The per-sync membership the removal rule needs survives the collapse.
  assert.deepEqual(db.prepare('SELECT sync_id, word_id FROM study_window_member').all(), [
    { sync_id: 's1', word_id: 'w1' }
  ]);
  assert.deepEqual(
    db.prepare('SELECT version FROM schema_migration ORDER BY version').all(),
    [{ version: 6 }]
  );
  db.close();
});

test('版本 3 的按批次学习记录被折叠成一词一行，保留最近一次观测', () => {
  const db = new Database(':memory:');
  migrate(db);
  const insertSync = db.prepare(
    `INSERT INTO mirror_sync VALUES(?, 'study_record_window', ?, NULL, '北京时间的下次学习日期', 1000, 1, 1, ?, 'complete', 'success', NULL, ?, ?)`
  );
  insertSync.run('older', 'backfill:all', 'backfill:all', '2026-09-13T01:00:00.000Z', '2026-09-13T01:00:00.000Z');
  insertSync.run('newer', 'backfill:all', 'backfill:all', '2026-09-13T02:00:00.000Z', '2026-09-13T02:00:00.000Z');
  db.prepare("INSERT INTO mirror_word VALUES('w1','alpha','t','t','current','t','newer')").run();
  // Restore the version-3 shape: one row per sync and word.
  db.exec('DROP TABLE study_record');
  db.exec(`
    CREATE TABLE study_record (
      sync_id TEXT NOT NULL REFERENCES mirror_sync(id) ON DELETE CASCADE,
      word_id TEXT NOT NULL REFERENCES mirror_word(word_id),
      add_date TEXT, first_study_date TEXT, last_study_date TEXT, next_study_date TEXT,
      study_count INTEGER, tags TEXT, PRIMARY KEY(sync_id, word_id)
    )
  `);
  const insertLegacy = db.prepare(
    'INSERT INTO study_record VALUES(?,?,?,?,?,?,?,?)'
  );
  insertLegacy.run('older', 'w1', '2026-09-01', '2026-09-01', '2026-09-10', '2026-09-20', 1, null);
  insertLegacy.run(
    'newer',
    'w1',
    '2026-09-01',
    '2026-09-01',
    '2026-09-13',
    '2026-09-22',
    2,
    '["STICKING"]'
  );

  migrate(db);

  assert.deepEqual(
    db
      .prepare(
        'SELECT word_id, last_study_date, next_study_date, study_count, tags, latest_sync_id FROM study_record'
      )
      .all(),
    [
      {
        word_id: 'w1',
        last_study_date: '2026-09-13',
        next_study_date: '2026-09-22',
        study_count: 2,
        tags: '["STICKING"]',
        latest_sync_id: 'newer'
      }
    ]
  );
  assert.deepEqual(
    db.prepare('SELECT sync_id, word_id FROM study_window_member ORDER BY sync_id').all(),
    [
      { sync_id: 'newer', word_id: 'w1' },
      { sync_id: 'older', word_id: 'w1' }
    ]
  );
  // The rebuild renames the old table, which carries its indexes with it; the
  // rebuilt table must still end up indexed rather than silently skipped.
  assert.deepEqual(
    db
      .prepare("SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%' ORDER BY name")
      .all(),
    [
      { name: 'idx_mirror_sync_scope', tbl_name: 'mirror_sync' },
      { name: 'idx_quiz_mistake_last', tbl_name: 'quiz_mistake' },
      { name: 'idx_study_record_last', tbl_name: 'study_record' },
      { name: 'idx_study_record_next', tbl_name: 'study_record' }
    ]
  );
  db.close();
});

test('归一化对无法解析的日期不作为，不擦除既有值', () => {
  const db = new Database(':memory:');
  migrate(db);
  db.prepare(
    `INSERT INTO mirror_sync VALUES('s1','today_snapshot','today:2026-09-13','2026-09-13','墨墨当天项目',1000,0,NULL,'范围','unknown','empty',NULL,'2026-09-13T09:43:21.518Z','2026-09-13T09:43:21.518Z')`
  ).run();
  db.prepare("INSERT INTO mirror_word VALUES('w1','alpha','t','t','current','t','s1')").run();
  db.prepare(
    `INSERT INTO study_record(word_id,add_date,first_study_date,last_study_date,next_study_date,study_count,tags,observed_at,latest_sync_id)
     VALUES('w1',NULL,'unknown-value','2026-09-12T16:00:00.000Z',NULL,1,NULL,'t','s1')`
  ).run();

  migrate(db);

  assert.deepEqual(
    db.prepare('SELECT first_study_date, last_study_date FROM study_record').get(),
    { first_study_date: 'unknown-value', last_study_date: '2026-09-13' }
  );
  db.close();
});

test('文件数据库启用 WAL、外键，且清理只处理 SQLite 侧文件', () => {
  const directory = mkdtempSync(join(tmpdir(), 'momo-migration-'));
  const path = join(directory, 'learning.sqlite');
  const db = new Database(path);
  migrate(db);
  assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table'").all() as {
    sql: string;
  }[];
  assert.equal(
    schema.some((row) => /token|authorization/i.test(row.sql)),
    false
  );
  db.close();
  writeFileSync(`${path}-wal`, 'temporary');
  writeFileSync(`${path}-shm`, 'temporary');
  removeDatabaseSidecars(path);
  assert.equal(existsSync(`${path}-wal`), false);
  assert.equal(existsSync(`${path}-shm`), false);
  rmSync(directory, { recursive: true, force: true });
});
