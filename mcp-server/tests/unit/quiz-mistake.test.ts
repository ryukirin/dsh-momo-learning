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

test('错题本一词一行：重复答错只累计次数，不新增行', () => {
  const repository = open();
  const first = repository.saveQuizMistakes('2026-09-13', [
    { wordId: 'w1', spelling: 'alpha', prompt: 'The ___ was stiff.', type: '语境选词' }
  ]);
  assert.deepEqual(first, { added: 1, repeated: 0 });

  const second = repository.saveQuizMistakes('2026-09-14', [
    { wordId: 'w1', spelling: 'alpha', prompt: 'They paid a ___ price.', type: '熟词僻义' },
    { wordId: 'w2', spelling: 'beta', type: '形近辨析' }
  ]);
  assert.deepEqual(second, { added: 1, repeated: 1 });

  const listed = repository.listQuizMistakes({ includeCleared: false, pageSize: 20, offset: 0 });
  assert.equal(listed.total, 2);
  assert.deepEqual(listed.words[0], {
    wordId: 'w1',
    spelling: 'alpha',
    firstMissedDay: '2026-09-13',
    lastMissedDay: '2026-09-14',
    missCount: 2,
    lastPrompt: 'They paid a ___ price.',
    lastType: '熟词僻义',
    clearedDay: null
  });
  assert.deepEqual(repository.quizMistakeSummary(), { open: 2, cleared: 0 });
});

test('答对可消除错题，再答错会重新打开', () => {
  const repository = open();
  repository.saveQuizMistakes('2026-09-13', [{ wordId: 'w1', spelling: 'alpha' }]);

  assert.equal(repository.clearQuizMistake('w1', '2026-09-14'), true);
  // A word with no mistake row is never written: correct answers leave no trace.
  assert.equal(repository.clearQuizMistake('never-missed', '2026-09-14'), false);
  assert.equal(repository.listQuizMistakes({ includeCleared: false, pageSize: 20, offset: 0 }).total, 0);
  assert.deepEqual(repository.quizMistakeSummary(), { open: 0, cleared: 1 });
  assert.equal(
    repository.listQuizMistakes({ includeCleared: true, pageSize: 20, offset: 0 }).words[0]?.clearedDay,
    '2026-09-14'
  );

  repository.saveQuizMistakes('2026-09-15', [{ wordId: 'w1', spelling: 'alpha' }]);
  assert.deepEqual(repository.quizMistakeSummary(), { open: 1, cleared: 0 });
  assert.equal(
    repository.listQuizMistakes({ includeCleared: false, pageSize: 20, offset: 0 }).words[0]?.missCount,
    2
  );
});

test('错题按错得最多排序，分页稳定', () => {
  const repository = open();
  repository.saveQuizMistakes('2026-09-13', [
    { wordId: 'once', spelling: 'once' },
    { wordId: 'thrice', spelling: 'thrice' }
  ]);
  repository.saveQuizMistakes('2026-09-14', [{ wordId: 'thrice', spelling: 'thrice' }]);
  repository.saveQuizMistakes('2026-09-15', [{ wordId: 'thrice', spelling: 'thrice' }]);

  const page = repository.listQuizMistakes({ includeCleared: false, pageSize: 1, offset: 0 });
  assert.equal(page.total, 2);
  assert.equal(page.words[0]?.wordId, 'thrice');
  assert.equal(
    repository.listQuizMistakes({ includeCleared: false, pageSize: 1, offset: 1 }).words[0]?.wordId,
    'once'
  );
});

test('空错题列表不写任何行', () => {
  const repository = open();
  assert.deepEqual(repository.saveQuizMistakes('2026-09-13', []), { added: 0, repeated: 0 });
  assert.deepEqual(repository.quizMistakeSummary(), { open: 0, cleared: 0 });
});

test('候选取自整个镜像，排除今天刚新学的，并按不熟程度排序', () => {
  const db = new Database(':memory:');
  migrate(db);
  const repository = new MirrorRepository(db);

  // Today's list: a brand-new word and a reviewed word the app says was forgotten.
  repository.saveToday(
    [
      { wordId: 'fresh', spelling: 'fresh', order: 1, isNew: true, firstResponse: 'FORGET' },
      { wordId: 'missed', spelling: 'missed', order: 2, isNew: false, firstResponse: 'FORGET' }
    ],
    '2026-09-13'
  );
  // The plan's older words, only one of which is in today's list.
  repository.saveStudyWindow(
    [
      { wordId: 'sticky', spelling: 'sticky', lastStudyDate: '2026-09-05', studyCount: 6, tags: ['STICKING'] },
      { wordId: 'rare', spelling: 'rare', lastStudyDate: '2026-08-20', studyCount: 1 },
      { wordId: 'solid', spelling: 'solid', lastStudyDate: '2026-09-12', studyCount: 9 },
      { wordId: 'missed', spelling: 'missed', lastStudyDate: '2026-09-13', studyCount: 4 }
    ],
    'backfill:all',
    undefined,
    4
  );
  repository.saveQuizMistakes('2026-09-12', [{ wordId: 'rare', spelling: 'rare' }]);

  const listing = repository.listQuizCandidates({ limit: 20, minDaysSinceStudy: 1, day: '2026-09-13' });
  const picked = listing.words.map((word) => word.wordId);
  // A word first met today is never quizzed the same day.
  assert.equal(picked.includes('fresh'), false);
  // Mistake first, then the app's own stubborn tag, then today's miss, then the rest.
  assert.deepEqual(picked, ['rare', 'sticky', 'missed', 'solid']);
  assert.equal(listing.words[0]?.reason, '本地错题');
  assert.equal(listing.words[1]?.reason, '墨墨标记顽固');
  assert.equal(listing.words[2]?.reason, '今天复习忘记');
  assert.equal(listing.total, 4);
});

test('间隔过滤挡住刚碰过的词，但今天没记住的例外', () => {
  const db = new Database(':memory:');
  migrate(db);
  const repository = new MirrorRepository(db);
  repository.saveToday(
    [{ wordId: 'forgot', spelling: 'forgot', order: 1, isNew: false, firstResponse: 'FORGET' }],
    '2026-09-13'
  );
  repository.saveStudyWindow(
    [
      { wordId: 'forgot', spelling: 'forgot', lastStudyDate: '2026-09-13', studyCount: 3 },
      { wordId: 'touched', spelling: 'touched', lastStudyDate: '2026-09-13', studyCount: 3 },
      { wordId: 'aged', spelling: 'aged', lastStudyDate: '2026-09-01', studyCount: 3 }
    ],
    'backfill:all',
    undefined,
    3
  );

  // A 3-day gap admits only the aged word, plus today's miss as the exception.
  assert.deepEqual(
    repository
      .listQuizCandidates({ limit: 20, minDaysSinceStudy: 3, day: '2026-09-13' })
      .words.map((word) => word.wordId),
    ['forgot', 'aged']
  );
  // With no gap required, the word merely touched today is eligible too.
  assert.deepEqual(
    repository
      .listQuizCandidates({ limit: 20, minDaysSinceStudy: 0, day: '2026-09-13' })
      .words.map((word) => word.wordId),
    ['forgot', 'aged', 'touched']
  );
});
