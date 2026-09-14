import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrations.js';
import { MirrorRepository } from '../../src/db/mirror-repository.js';

test('当前规划默认不含移出词，历史和 includeRemoved 使用本地分页', () => {
  const db = new Database(':memory:');
  migrate(db);
  const mirror = new MirrorRepository(db);
  mirror.saveStudyWindow(
    [
      { wordId: 'current', spelling: 'current' },
      { wordId: 'removed', spelling: 'removed' }
    ],
    'beijing:2026-09-13:2026-09-14',
    2,
    1000
  );
  mirror.saveStudyWindow(
    [{ wordId: 'current', spelling: 'current' }],
    'beijing:2026-09-13:2026-09-14',
    1,
    1000
  );
  assert.equal(mirror.listPlanning('current_planning', false, 20, 0).total, 1);
  assert.equal(mirror.listPlanning('removed_history', false, 20, 0).total, 1);
  assert.deepEqual(mirror.listPlanning('current_planning', true, 1, 1).words, [
    { wordId: 'removed', spelling: 'removed', planState: 'removed_from_current_plan' }
  ]);
  db.close();
});
