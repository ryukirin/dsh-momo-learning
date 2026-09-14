import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrations.js';
import { MirrorRepository } from '../../src/db/mirror-repository.js';

test('当天快照保留上游 order 与状态，不把学习记录混入其中', () => {
  const db = new Database(':memory:');
  migrate(db);
  const mirror = new MirrorRepository(db);
  const sync = mirror.saveToday(
    [
      { wordId: 'second', spelling: 'second', order: 2, isNew: false, isFinished: true },
      { wordId: 'first', spelling: 'first', order: 1, isNew: true, isFinished: false }
    ],
    '2026-09-13'
  );
  assert.deepEqual(mirror.listToday(sync.syncId, 50, 0), [
    { wordId: 'first', spelling: 'first', order: 1, isNew: 1, isFinished: 0, firstResponse: null },
    { wordId: 'second', spelling: 'second', order: 2, isNew: 0, isFinished: 1, firstResponse: null }
  ]);
  assert.equal(sync.completeness, 'unknown');
  db.close();
});
