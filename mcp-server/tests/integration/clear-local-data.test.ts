import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrations.js';
import { clearLocalLearningData } from '../../src/db/local-data-clearer.js';

test('清除只删除本地学习表', () => {
  const db = new Database(':memory:');
  migrate(db);
  db.prepare(
    `INSERT INTO mirror_sync VALUES('s','today_snapshot','k',NULL,'x',1000,0,NULL,'x','unknown','empty',NULL,'x','x')`
  ).run();
  assert.equal(clearLocalLearningData(db).deletedRows > 0, true);
  assert.equal(
    (db.prepare('SELECT count(*) AS count FROM mirror_sync').get() as { count: number }).count,
    0
  );
  db.close();
});
