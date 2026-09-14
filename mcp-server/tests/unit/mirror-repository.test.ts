import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrations.js';
import { MirrorRepository } from '../../src/db/mirror-repository.js';

test('学习记录完整同步才更新当前规划状态，并保存记录字段', () => {
  const db = new Database(':memory:');
  migrate(db);
  const repository = new MirrorRepository(db);
  repository.saveToday(
    [
      { wordId: 'kept', spelling: 'kept', order: 1 },
      { wordId: 'removed', spelling: 'removed', order: 2 }
    ],
    '2026-09-13'
  );
  repository.saveStudyWindow(
    [
      { wordId: 'kept', spelling: 'kept' },
      { wordId: 'removed', spelling: 'removed' }
    ],
    'beijing:2026-09-13:2026-09-14',
    2,
    1000
  );
  const sync = repository.saveStudyWindow(
    [
      {
        wordId: 'kept',
        spelling: 'kept',
        nextStudyDate: '2026-09-14',
        studyCount: 3,
        tags: ['考试']
      }
    ],
    'beijing:2026-09-13:2026-09-14',
    1,
    1000
  );
  assert.equal(sync.completeness, 'complete');
  assert.deepEqual(
    db.prepare('SELECT plan_state FROM mirror_word WHERE word_id=?').get('removed'),
    { plan_state: 'removed_from_current_plan' }
  );
  assert.deepEqual(
    db
      .prepare('SELECT next_study_date,study_count,tags FROM study_record WHERE word_id=?')
      .get('kept'),
    { next_study_date: '2026-09-14', study_count: 3, tags: '["考试"]' }
  );
  db.close();
});

test('完整同步只会移出同一范围此前出现的词', () => {
  const db = new Database(':memory:');
  migrate(db);
  const repository = new MirrorRepository(db);
  repository.saveStudyWindow(
    [{ wordId: 'range-a', spelling: 'range-a' }],
    'beijing:2026-09-13:2026-09-14',
    1,
    1000
  );
  repository.saveStudyWindow(
    [{ wordId: 'range-b', spelling: 'range-b' }],
    'beijing:2026-09-15:2026-09-16',
    1,
    1000
  );
  repository.saveStudyWindow([], 'beijing:2026-09-13:2026-09-14', 0, 1000);
  assert.deepEqual(
    db.prepare('SELECT plan_state FROM mirror_word WHERE word_id=?').get('range-a'),
    { plan_state: 'removed_from_current_plan' }
  );
  assert.deepEqual(
    db.prepare('SELECT plan_state FROM mirror_word WHERE word_id=?').get('range-b'),
    { plan_state: 'current' }
  );
  db.close();
});

test('本地规划词列表默认排除移出词，并支持本地分页和显式历史查询', () => {
  const db = new Database(':memory:');
  migrate(db);
  const repository = new MirrorRepository(db);
  repository.saveStudyWindow(
    [
      { wordId: 'active', spelling: 'active' },
      { wordId: 'removed', spelling: 'removed' }
    ],
    'beijing:2026-09-13:2026-09-14',
    2,
    1000
  );
  repository.saveStudyWindow(
    [{ wordId: 'active', spelling: 'active' }],
    'beijing:2026-09-13:2026-09-14',
    1,
    1000
  );
  assert.deepEqual(repository.listPlanning('current_planning', false, 20, 0), {
    words: [{ wordId: 'active', spelling: 'active', planState: 'current' }],
    total: 1
  });
  assert.deepEqual(repository.listPlanning('current_planning', true, 1, 1), {
    words: [{ wordId: 'removed', spelling: 'removed', planState: 'removed_from_current_plan' }],
    total: 2
  });
  assert.deepEqual(repository.listPlanning('removed_history', false, 20, 0), {
    words: [{ wordId: 'removed', spelling: 'removed', planState: 'removed_from_current_plan' }],
    total: 1
  });
  db.close();
});

test('未知或部分学习记录同步不会修改已有规划状态', () => {
  const db = new Database(':memory:');
  migrate(db);
  const repository = new MirrorRepository(db);
  repository.saveToday(
    [
      { wordId: 'one', spelling: 'one', order: 1 },
      { wordId: 'two', spelling: 'two', order: 2 }
    ],
    '2026-09-13'
  );
  const sync = repository.saveStudyWindow(
    [{ wordId: 'one', spelling: 'one' }],
    'beijing:2026-09-13:2026-09-14',
    undefined,
    1000
  );
  assert.equal(sync.completeness, 'unknown');
  assert.deepEqual(db.prepare('SELECT plan_state FROM mirror_word WHERE word_id=?').get('two'), {
    plan_state: 'current'
  });
  db.close();
});

test('达到本次上游上限时即使可得总数也只标记为部分镜像', () => {
  const db = new Database(':memory:');
  migrate(db);
  const repository = new MirrorRepository(db);
  const sync = repository.saveStudyWindow(
    [
      { wordId: 'one', spelling: 'one' },
      { wordId: 'two', spelling: 'two' }
    ],
    'beijing:2026-09-13:2026-09-14',
    2,
    2
  );
  assert.equal(sync.completeness, 'partial');
  db.close();
});

test('当天词表保留墨墨记录的作答结果，并可按出题范围筛选', () => {
  const db = new Database(':memory:');
  migrate(db);
  const repository = new MirrorRepository(db);
  const sync = repository.saveToday(
    [
      { wordId: 'new-forget', spelling: 'nf', order: 1, isNew: true, firstResponse: 'FORGET' },
      { wordId: 'new-vague', spelling: 'nv', order: 2, isNew: true, firstResponse: 'VAGUE' },
      { wordId: 'rev-forget', spelling: 'rf', order: 3, isNew: false, firstResponse: 'FORGET' },
      { wordId: 'rev-known', spelling: 'rk', order: 4, isNew: false, firstResponse: 'FAMILIAR' }
    ],
    '2026-09-13'
  );

  // A newly learned word is worth a first-pass question only when the app says it
  // was forgotten; a reviewed word the app already confirmed as known is skipped.
  assert.deepEqual(
    repository
      .listTodayPage(sync.syncId, { responses: ['FORGET'], isNew: true, pageSize: 20, offset: 0 })
      .words.map((word) => word.wordId),
    ['new-forget']
  );
  assert.deepEqual(
    repository
      .listTodayPage(sync.syncId, {
        responses: ['FORGET', 'VAGUE'],
        isNew: false,
        pageSize: 20,
        offset: 0
      })
      .words.map((word) => word.wordId),
    ['rev-forget']
  );
  assert.equal(repository.listTodayPage(sync.syncId, { pageSize: 20, offset: 0 }).total, 4);
  assert.deepEqual(repository.todayResponseCounts(sync.syncId), {
    FORGET: 2,
    VAGUE: 1,
    FAMILIAR: 1
  });
  assert.equal(
    repository.listTodayPage(sync.syncId, { pageSize: 1, offset: 1 }).words[0]?.firstResponse,
    'VAGUE'
  );
  db.close();
});

test('上游 order 重复时仍能保存当天快照，并按 order+word_id 稳定排序', () => {
  const db = new Database(':memory:');
  migrate(db);
  const repository = new MirrorRepository(db);
  // Real upstream data: 150 items across 135 distinct orders, so duplicate
  // orders are the normal case and must never reject a snapshot.
  const sync = repository.saveToday(
    [
      { wordId: 'b-second', spelling: 'second', order: 10 },
      { wordId: 'a-first', spelling: 'first', order: 10 },
      { wordId: 'c-third', spelling: 'third', order: 20 }
    ],
    '2026-09-13'
  );
  assert.equal(sync.completeness, 'unknown');
  assert.deepEqual(
    repository.listToday(sync.syncId, 20, 0).map((row) => row.wordId),
    ['a-first', 'b-second', 'c-third']
  );
  db.close();
});

test('同步批次写入失败时不会污染上一份成功镜像', () => {
  const db = new Database(':memory:');
  migrate(db);
  const repository = new MirrorRepository(db);
  const previous = repository.saveToday(
    [{ wordId: 'stable', spelling: 'stable', order: 1 }],
    '2026-09-13'
  );
  assert.throws(() =>
    repository.saveStudyWindow(
      [
        { wordId: 'duplicate', spelling: 'duplicate' },
        { wordId: 'duplicate', spelling: 'duplicate' }
      ],
      'beijing:2026-09-13:2026-09-14',
      2,
      1000
    )
  );
  assert.deepEqual(repository.latestToday()?.id, previous.syncId);
  assert.deepEqual(
    db
      .prepare("SELECT COUNT(*) AS count FROM mirror_sync WHERE scope_type='study_record_window'")
      .get(),
    { count: 0 }
  );
  assert.deepEqual(
    db.prepare("SELECT COUNT(*) AS count FROM mirror_word WHERE word_id='duplicate'").get(),
    { count: 0 }
  );
  db.close();
});
