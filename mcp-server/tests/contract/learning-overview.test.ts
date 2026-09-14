import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrations.js';
import { MirrorRepository } from '../../src/db/mirror-repository.js';

test('学习概况可在空镜像和已有镜像下只从本地读取证据', () => {
  const db = new Database(':memory:');
  migrate(db);
  const mirror = new MirrorRepository(db);
  assert.equal(mirror.latestToday(), undefined);
  mirror.saveToday([], '2026-09-13');
  const latest = mirror.latestToday();
  assert.equal(latest?.requested_local_date, '2026-09-13');
  assert.equal(latest?.completeness, 'unknown');
  assert.equal(latest?.upstream_date_semantics, '墨墨当天项目');
  db.close();
});
