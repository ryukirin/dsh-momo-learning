import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrations.js';
import { MirrorRepository } from '../../src/db/mirror-repository.js';
import { TodoRepository } from '../../src/db/todo-repository.js';

test('待办仅推进一项，并覆盖确认、跳过、暂停、恢复与冲突', () => {
  const db = new Database(':memory:');
  migrate(db);
  const mirror = new MirrorRepository(db);
  const snapshot = mirror.saveToday(
    [
      { wordId: 'one', spelling: 'one', order: 1 },
      { wordId: 'two', spelling: 'two', order: 2 }
    ],
    '2026-09-13'
  );
  const todos = new TodoRepository(db);
  const opened = todos.open(snapshot.syncId, '2026-09-13');
  const first = String(opened.current_entry_id);
  assert.throws(() => todos.update(String(opened.id), 'skip', 'stale'));
  const skipped = todos.update(String(opened.id), 'skip', first);
  const second = String(skipped.current_entry_id);
  assert.notEqual(second, first);
  const paused = todos.update(String(opened.id), 'pause_current', second);
  assert.equal((paused.entries as { status: string }[])[1].status, 'paused');
  const resumed = todos.update(String(opened.id), 'resume');
  const completed = todos.update(
    String(opened.id),
    'mark_understood',
    String(resumed.current_entry_id)
  );
  assert.equal(completed.status, 'completed');
  db.close();
});
