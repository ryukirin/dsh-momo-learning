import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('测验场景禁止擅自出题和超范围承诺', () => {
  const skill = readFileSync(
    resolve(process.cwd(), '../skills/momo-daily-learning/SKILL.md'),
    'utf8'
  );
  assert.match(skill, /不得擅自出题/);
  assert.match(skill, /不得声称覆盖全部/);
  assert.doesNotMatch(skill, /所有已学单词|所有已规划单词/);
  // A missed day cannot be reconstructed from upstream, so the skill must not
  // promise a day-by-day history it cannot obtain.
  assert.match(skill, /FAMILIAR` 的词一律不考/);
});
