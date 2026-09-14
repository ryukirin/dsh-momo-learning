import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrations.js';
import { MirrorRepository } from '../../src/db/mirror-repository.js';
import { TodoRepository } from '../../src/db/todo-repository.js';

interface Session {
  id: string;
  current_entry_id: string | null;
  status: string;
  entries: { id: string; word_id: string; status: string }[];
}

test('上游 order 重复时逐词推进不跳过同序项，完成最后一词才置为 completed', () => {
  const db = new Database(':memory:');
  migrate(db);
  const sync = new MirrorRepository(db).saveToday(
    [
      { wordId: 'a', spelling: 'a', order: 10 },
      { wordId: 'b', spelling: 'b', order: 10 },
      { wordId: 'c', spelling: 'c', order: 20 }
    ],
    '2026-09-13'
  );
  const todos = new TodoRepository(db);
  let session = todos.open(sync.syncId, '2026-09-13') as unknown as Session;
  assert.equal(session.entries.length, 3);

  const visited: string[] = [];
  let guard = 0;
  while (session.current_entry_id && guard < 5) {
    const current = session.entries.find((entry) => entry.id === session.current_entry_id);
    assert.ok(current);
    visited.push(current.word_id);
    session = todos.update(
      session.id,
      'mark_understood',
      session.current_entry_id
    ) as unknown as Session;
    guard += 1;
  }

  assert.deepEqual(visited, ['a', 'b', 'c']);
  assert.equal(session.status, 'completed');
  db.close();
});

test('基于空快照建立的空待办会被非空快照重建，非空待办不被重建', () => {
  const db = new Database(':memory:');
  migrate(db);
  const mirror = new MirrorRepository(db);
  const empty = mirror.saveToday([], '2026-09-13');
  const filled = mirror.saveToday([{ wordId: 'alpha', spelling: 'alpha', order: 2 }], '2026-09-13');
  const todos = new TodoRepository(db);

  const wedged = todos.open(empty.syncId, '2026-09-13') as unknown as Session;
  assert.equal(wedged.entries.length, 0);

  const rebuilt = todos.open(filled.syncId, '2026-09-13') as unknown as Session;
  assert.notEqual(rebuilt.id, wedged.id);
  assert.deepEqual(
    rebuilt.entries.map((entry) => entry.word_id),
    ['alpha']
  );
  assert.equal(
    (db.prepare('SELECT status FROM todo_session WHERE id=?').get(wedged.id) as { status: string })
      .status,
    'abandoned'
  );

  assert.equal((todos.open(filled.syncId, '2026-09-13') as unknown as Session).id, rebuilt.id);
  db.close();
});

test('重复挂载同一本地日期返回既有待办而不是重建', () => {
  const db = new Database(':memory:');
  migrate(db);
  const sync = new MirrorRepository(db).saveToday(
    [{ wordId: 'only', spelling: 'only', order: 1 }],
    '2026-09-13'
  );
  const todos = new TodoRepository(db);
  const first = todos.open(sync.syncId, '2026-09-13') as unknown as Session;
  const second = todos.open(sync.syncId, '2026-09-13') as unknown as Session;
  assert.equal(second.id, first.id);
  assert.deepEqual(
    second.entries.map((entry) => entry.id),
    first.entries.map((entry) => entry.id)
  );
  db.close();
});
