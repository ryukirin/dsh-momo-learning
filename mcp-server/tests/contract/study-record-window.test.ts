import test from 'node:test';
import assert from 'node:assert/strict';
import { MaimemoClient } from '../../src/api/maimemo-client.js';
import { getStudyRecords } from '../../src/api/study-records.js';
import type { SecretStore } from '../../src/auth/secret-store.js';

const secrets: SecretStore = {
  get: () => 'test-token',
  set: () => undefined,
  remove: () => true,
  available: () => true
};

test('学习记录窗口按北京时间请求数据和 as_count，不伪造远端续页', async () => {
  const bodies: Record<string, unknown>[] = [];
  const responses = [
    new Response(JSON.stringify({ records: [{ voc_id: '1', voc_spelling: 'word' }] })),
    new Response(JSON.stringify({ count: 1 }))
  ];
  const client = new MaimemoClient(secrets, (async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return responses.shift() as Response;
  }) as typeof fetch);
  const result = await getStudyRecords(client, '2026-09-13', '2026-09-14', 1000);
  assert.deepEqual(result, { records: [{ voc_id: '1', voc_spelling: 'word' }], count: 1 });
  // The range is sent with an explicit +08:00 offset: a bare `YYYY-MM-DD` reaches
  // upstream as UTC midnight, which would drop the first eight hours of the start day.
  assert.deepEqual(bodies, [
    {
      next_study_date: { start: '2026-09-13T00:00:00+08:00', end: '2026-09-14T23:59:59+08:00' },
      limit: 1000
    },
    {
      next_study_date: { start: '2026-09-13T00:00:00+08:00', end: '2026-09-14T23:59:59+08:00' },
      limit: 1000,
      as_count: true
    }
  ]);
  assert.equal('cursor' in bodies[0], false);
  assert.equal('offset' in bodies[0], false);
});

test('上游日期即时值在写入前归一化为北京日历日', async () => {
  const responses = [
    new Response(
      JSON.stringify({
        records: [
          {
            voc_id: '1',
            voc_spelling: 'word',
            add_date: '2026-08-31T16:00:00.000Z',
            first_study_date: '2026-08-31T16:00:00.000Z',
            last_study_date: '2026-09-12T16:00:00.000Z',
            next_study_date: '2026-09-15T16:00:00.000Z'
          }
        ]
      })
    ),
    new Response(JSON.stringify({ count: 1 }))
  ];
  const client = new MaimemoClient(secrets, (async () => responses.shift() as Response) as typeof fetch);
  const result = await getStudyRecords(client, '2026-09-01', '2026-09-30', 1000);
  assert.deepEqual(result.records, [
    {
      voc_id: '1',
      voc_spelling: 'word',
      add_date: '2026-09-01',
      first_study_date: '2026-09-01',
      last_study_date: '2026-09-13',
      next_study_date: '2026-09-16'
    }
  ]);
});
