import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrations.js';
import { MirrorRepository } from '../../src/db/mirror-repository.js';
import { TodoRepository } from '../../src/db/todo-repository.js';

test('理解当前词时只推进到相邻未完成项', () => {
  const db = new Database(':memory:');
  migrate(db);
  const mirror = new MirrorRepository(db);
  const snapshot = mirror.saveToday(
    [
      { wordId: '1', spelling: 'first', order: 1 },
      { wordId: '2', spelling: 'second', order: 2 }
    ],
    '2026-09-13'
  );
  const todos = new TodoRepository(db);
  const opened = todos.open(snapshot.syncId, '2026-09-13');
  const current = String(opened.current_entry_id);
  const updated = todos.update(String(opened.id), 'mark_understood', current);
  assert.notEqual(updated.current_entry_id, current);
  db.close();
});

test('暂停和恢复只改变临时状态，且拒绝错误快照和过期当前项', () => {
  const db = new Database(':memory:');
  migrate(db);
  const mirror = new MirrorRepository(db);
  const snapshot = mirror.saveToday([{ wordId: '1', spelling: 'first', order: 1 }], '2026-09-13');
  const todos = new TodoRepository(db);
  assert.throws(() => todos.open('not-a-snapshot', '2026-09-12'));
  const opened = todos.open(snapshot.syncId, '2026-09-13');
  const current = String(opened.current_entry_id);
  assert.throws(() => todos.update(String(opened.id), 'skip', 'stale-entry'));
  const paused = todos.update(String(opened.id), 'pause_current', current);
  assert.equal(paused.current_entry_id, null);
  assert.equal(paused.paused_entry_id, current);
  assert.equal((paused.entries as { id: string; status: string }[])[0].status, 'paused');
  const resumed = todos.update(String(opened.id), 'resume');
  assert.equal(resumed.current_entry_id, current);
  assert.equal(resumed.paused_entry_id, null);
  assert.equal((resumed.entries as { id: string; status: string }[])[0].status, 'pending');
  db.close();
});
