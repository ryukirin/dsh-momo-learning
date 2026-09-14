import test from 'node:test';
import assert from 'node:assert/strict';
import { commonPrefixLength, editDistance, rankSimilarWords } from '../../src/similar.js';

test('编辑距离按字符计算，大小写不敏感', () => {
  assert.equal(editDistance('adopt', 'adapt'), 1);
  assert.equal(editDistance('adopt', 'ADOPT'), 0);
  assert.equal(editDistance('', 'abc'), 3);
});

test('共同前缀按字符计算', () => {
  assert.equal(commonPrefixLength('adapt', 'adopt'), 2);
  assert.equal(commonPrefixLength('adapt', 'adept'), 2);
  assert.equal(commonPrefixLength('alpha', 'beta'), 0);
});

test('形近词按易混程度排序，编辑距离最近的排前，无关长词被排除', () => {
  const candidates = [
    { wordId: '1', spelling: 'adopt' },
    { wordId: '2', spelling: 'adapt' },
    { wordId: '3', spelling: 'adept' },
    { wordId: '4', spelling: 'elephant' }
  ];
  const ranked = rankSimilarWords('adopt', candidates, 10);
  // The two one-letter variants come first; the unrelated long word is dropped.
  assert.deepEqual(
    ranked.slice(0, 2).map((word) => word.spelling).sort(),
    ['adapt', 'adept']
  );
  assert.equal(ranked[0]?.distance, 1);
  assert.equal(ranked.some((word) => word.spelling === 'elephant'), false);
});

test('自身与仅大小写不同的写法不算易混项', () => {
  const ranked = rankSimilarWords('adopt', [
    { wordId: '1', spelling: 'adopt' },
    { wordId: '2', spelling: 'Adopt' },
    { wordId: '3', spelling: 'adapt' }
  ], 10);
  assert.deepEqual(
    ranked.map((word) => word.spelling),
    ['adapt']
  );
});

test('长度差距过大的词不进候选，limit 生效且顺序稳定', () => {
  const ranked = rankSimilarWords(
    'red',
    [
      { wordId: '1', spelling: 'rid' },
      { wordId: '2', spelling: 'rod' },
      { wordId: '3', spelling: 'unrelatedverylongword' }
    ],
    1
  );
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.spelling, 'rid');
});

test('空目标不返回候选', () => {
  assert.deepEqual(rankSimilarWords('   ', [{ wordId: '1', spelling: 'a' }], 5), []);
});
