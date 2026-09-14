import test from 'node:test';
import assert from 'node:assert/strict';
import { beijingDayGap, toBeijingDate } from '../../src/time.js';

test('上游的北京时间午夜 UTC 表示被还原成北京日历日', () => {
  // The upstream shape: Beijing midnight written as a UTC instant.
  assert.equal(toBeijingDate('2026-09-12T16:00:00.000Z'), '2026-09-13');
  assert.equal(toBeijingDate('2026-08-31T16:00:00.000Z'), '2026-09-01');
});

test('已是北京日历日的值再转换一次不变', () => {
  for (const day of ['2026-09-13', '2026-09-01', '2026-12-31']) {
    assert.equal(toBeijingDate(day), day);
  }
});

test('按北京而不是本机时区归天', () => {
  // 15:00Z is 23:00 in Beijing but already the next day in Tokyo, so a local-clock
  // conversion would name a different day than the one upstream scoped the list to.
  assert.equal(toBeijingDate('2026-09-13T15:00:00.000Z'), '2026-09-13');
  assert.equal(
    new Date('2026-09-13T15:00:00.000Z').toLocaleDateString('sv-SE', { timeZone: 'Asia/Tokyo' }),
    '2026-09-14'
  );
  assert.equal(toBeijingDate('2026-09-13T16:30:00.000Z'), '2026-09-14');
});

test('缺失值保持缺失，无法解析的值原样保留', () => {
  assert.equal(toBeijingDate(undefined), undefined);
  assert.equal(toBeijingDate(''), '');
  assert.equal(toBeijingDate('not-a-date'), 'not-a-date');
});

test('空档按北京日历日计，跨过北京午夜就算一天', () => {
  // The gap decides whether a day's word list went unread, so it counts 墨墨's
  // day boundaries rather than elapsed hours.
  assert.equal(beijingDayGap('2026-09-10', '2026-09-13'), 3);
  assert.equal(beijingDayGap('2026-09-13T09:00:00.000Z', '2026-09-13T15:00:00.000Z'), 0);
  assert.equal(beijingDayGap('2026-09-13T15:59:00.000Z', '2026-09-13T16:01:00.000Z'), 1);
  assert.equal(beijingDayGap('2026-09-13', '2026-09-10'), -3);
  assert.equal(beijingDayGap('not-a-date', '2026-09-13'), undefined);
});
