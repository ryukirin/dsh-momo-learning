import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrations.js';
import { MirrorRepository } from '../../src/db/mirror-repository.js';
import { TodoRepository } from '../../src/db/todo-repository.js';

test('待办在同一数据库重建仓库后可恢复，并可暂停恢复当前词', () => {
  const db = new Database(':memory:');
  migrate(db);
  const snapshot = new MirrorRepository(db).saveToday(
    [{ wordId: 'word', spelling: 'word', order: 1 }],
    '2026-09-13'
  );
  const first = new TodoRepository(db).open(snapshot.syncId, '2026-09-13');
  const resumed = new TodoRepository(db).open(snapshot.syncId, '2026-09-13');
  assert.equal(resumed.id, first.id);
  db.close();
});
