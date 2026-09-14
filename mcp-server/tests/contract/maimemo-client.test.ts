import test from 'node:test';
import assert from 'node:assert/strict';
import { MaimemoClient } from '../../src/api/maimemo-client.js';
import { MaimemoError } from '../../src/errors.js';
import type { SecretStore } from '../../src/auth/secret-store.js';

const secrets: SecretStore = {
  get: () => 'secret-token-that-must-not-appear',
  set: () => undefined,
  remove: () => true,
  available: () => true
};

const clientFor = (response: Response | (() => Promise<Response>), timeoutMs = 10) =>
  new MaimemoClient(
    secrets,
    (async () => (typeof response === 'function' ? response() : response)) as typeof fetch,
    timeoutMs
  );

const expectCode = async (client: MaimemoClient, code: string): Promise<void> => {
  await assert.rejects(
    () => client.post('/open/api/v1/memo/study/get_today_items', {}),
    (error: unknown) => error instanceof MaimemoError && error.code === code
  );
};

test('HTTP 错误被映射为脱敏的固定错误类别', async () => {
  await expectCode(
    clientFor(new Response('raw credential response', { status: 401 })),
    'AUTH_INVALID'
  );
  await expectCode(
    clientFor(new Response('raw credential response', { status: 403 })),
    'AUTH_FORBIDDEN'
  );
  await expectCode(
    clientFor(
      new Response('raw credential response', { status: 429, headers: { 'retry-after': '8' } })
    ),
    'UPSTREAM_RATE_LIMITED'
  );
  await expectCode(
    clientFor(new Response('raw credential response', { status: 500 })),
    'UPSTREAM_UNAVAILABLE'
  );
});

test('超时和未知字段不会泄露令牌或原始响应', async () => {
  const timeoutClient = clientFor(
    () =>
      new Promise<Response>((_, reject) => {
        setTimeout(() => reject(new DOMException('aborted', 'AbortError')), 1);
      }),
    1
  );
  await expectCode(timeoutClient, 'UPSTREAM_TIMEOUT');
  const response = await clientFor(
    new Response(JSON.stringify({ records: [], unexpected: { anything: true } }), { status: 200 })
  ).post<{ records: unknown[] }>('/open/api/v1/memo/study/get_today_items', {});
  assert.deepEqual(response.records, []);
  await assert.rejects(
    () => clientFor(new Response('{}')).post('/not-allowed', {}),
    (error: unknown) => error instanceof MaimemoError && error.code === 'INVALID_ARGUMENT'
  );
});

test('墨墨 success/data 包装会在安全确认成功后解包', async () => {
  const value = await clientFor(
    new Response(JSON.stringify({ success: true, data: { today_items: [{ voc_id: '1' }] } }))
  ).post<{ today_items: { voc_id: string }[] }>('/open/api/v1/memo/study/get_today_items', {});
  assert.deepEqual(value, { today_items: [{ voc_id: '1' }] });
  await expectCode(
    clientFor(
      new Response(JSON.stringify({ success: false, errors: ['sensitive upstream body'] }))
    ),
    'UPSTREAM_PROTOCOL_ERROR'
  );
});
