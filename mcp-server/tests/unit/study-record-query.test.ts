import test from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { migrate } from '../../src/db/migrations.js';
import { MirrorRepository } from '../../src/db/mirror-repository.js';

const open = (): MirrorRepository => {
  const db = new Database(':memory:');
  migrate(db);
  return new MirrorRepository(db);
};

test('同一个词被多次同步只保留一行，最新一次观测生效', () => {
  const repository = open();
  repository.saveStudyWindow(
    [{ wordId: 'w1', spelling: 'alpha', lastStudyDate: '2026-09-10', studyCount: 1 }],
    'backfill:all',
    undefined,
    1
  );
  const second = repository.saveStudyWindow(
    [
      {
        wordId: 'w1',
        spelling: 'alpha',
        lastStudyDate: '2026-09-13',
        nextStudyDate: '2026-09-20',
        studyCount: 2,
        tags: ['STICKING']
      }
    ],
    'words:2026-09-13',
    undefined,
    1
  );
  const listing = repository.queryRecords({ includeRemoved: false, pageSize: 20, offset: 0 });
  assert.equal(listing.total, 1);
  assert.deepEqual(listing.words, [
    {
      wordId: 'w1',
      spelling: 'alpha',
      addDate: null,
      firstStudyDate: null,
      lastStudyDate: '2026-09-13',
      nextStudyDate: '2026-09-20',
      studyCount: 2,
      tags: '["STICKING"]',
      observedAt: listing.words[0]?.observedAt,
      planState: 'current'
    }
  ]);
  // A by-word refresh is a slice, so its sync can never claim completeness —
  // which is what keeps it from marking any word as no longer planned.
  assert.notEqual(second.completeness, 'complete');
});

test('本地记录按北京日期范围、标签和学习次数筛选', () => {
  const repository = open();
  repository.saveStudyWindow(
    [
      { wordId: 'a', spelling: 'a', lastStudyDate: '2026-09-01', studyCount: 1 },
      { wordId: 'b', spelling: 'b', lastStudyDate: '2026-09-10', studyCount: 3, tags: ['STICKING'] },
      { wordId: 'c', spelling: 'c', lastStudyDate: '2026-09-13', studyCount: 5, tags: ['WELL_FAMILIAR'] },
      { wordId: 'd', spelling: 'd', lastStudyDate: '2026-09-13', studyCount: 2, tags: ['STICKING'] }
    ],
    'backfill:all',
    undefined,
    4
  );

  const recent = repository.queryRecords({
    dateField: 'last_study_date',
    start: '2026-09-10',
    end: '2026-09-13',
    includeRemoved: false,
    pageSize: 20,
    offset: 0
  });
  assert.deepEqual(
    recent.words.map((word) => word.wordId),
    ['c', 'd', 'b']
  );
  assert.equal(recent.total, 3);

  const sticky = repository.queryRecords({
    tags: ['STICKING'],
    includeRemoved: false,
    pageSize: 20,
    offset: 0
  });
  assert.deepEqual(
    sticky.words.map((word) => word.wordId),
    ['d', 'b']
  );

  const repeated = repository.queryRecords({
    minStudyCount: 3,
    includeRemoved: false,
    pageSize: 20,
    offset: 0
  });
  assert.deepEqual(
    repeated.words.map((word) => word.wordId),
    ['c', 'b']
  );

  const paged = repository.queryRecords({
    dateField: 'last_study_date',
    start: '2026-09-10',
    end: '2026-09-13',
    includeRemoved: false,
    pageSize: 2,
    offset: 2
  });
  assert.deepEqual(
    paged.words.map((word) => word.wordId),
    ['b']
  );
  assert.equal(paged.total, 3);
});

test('计划覆盖只由证明过的全量回填产生，不被按词增量刷新冲掉', () => {
  const db = new Database(':memory:');
  migrate(db);
  const repository = new MirrorRepository(db);
  assert.equal(repository.planCoverage(), undefined);

  repository.recordPlanCoverage(689, 689);
  assert.equal(repository.planCoverage()?.completeness, 'complete');

  // The daily incremental refresh is a slice; it must not be mistaken for the
  // coverage proof, and it must remain the freshest read.
  const refresh = repository.saveStudyWindow(
    [{ wordId: 'w1', spelling: 'alpha', lastStudyDate: '2026-09-13' }],
    'words:2026-09-13',
    undefined,
    1
  );
  assert.equal(repository.latestStudyWindow()?.id, refresh.syncId);
  assert.equal(repository.latestStudyWindow()?.completeness, 'partial');
  assert.equal(repository.planCoverage()?.retrieved_count, 689);
  db.close();
});

test('标签按存储数组的元素匹配，不做子串匹配', () => {
  const repository = open();
  repository.saveStudyWindow(
    [
      { wordId: 'exact', spelling: 'exact', tags: ['STICKING'] },
      { wordId: 'other', spelling: 'other', tags: ['NOT_STICKING_AT_ALL'] }
    ],
    'backfill:all',
    undefined,
    2
  );
  const listing = repository.queryRecords({
    tags: ['STICKING'],
    includeRemoved: false,
    pageSize: 20,
    offset: 0
  });
  assert.deepEqual(
    listing.words.map((word) => word.wordId),
    ['exact']
  );
});

test('同一范围的完整同步把缺失词标为移出，默认查询不再返回它', () => {
  const repository = open();
  repository.saveStudyWindow(
    [
      { wordId: 'kept', spelling: 'kept' },
      { wordId: 'gone', spelling: 'gone' }
    ],
    'backfill:all',
    2,
    1000
  );
  repository.saveStudyWindow([{ wordId: 'kept', spelling: 'kept' }], 'backfill:all', 1, 1000);

  assert.deepEqual(
    repository
      .queryRecords({ includeRemoved: false, pageSize: 20, offset: 0 })
      .words.map((word) => word.wordId),
    ['kept']
  );
  // The record itself is retained: excluding the word from a quiz scope must not
  // erase what the mirror already learned about it.
  const withRemoved = repository.queryRecords({
    includeRemoved: true,
    pageSize: 20,
    offset: 0
  });
  assert.deepEqual(
    withRemoved.words.map((word) => word.wordId).sort(),
    ['gone', 'kept']
  );
  assert.equal(withRemoved.words.find((word) => word.wordId === 'gone')?.planState, 'removed_from_current_plan');
});
