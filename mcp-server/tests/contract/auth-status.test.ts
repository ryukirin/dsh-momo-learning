import test from 'node:test';
import assert from 'node:assert/strict';
import { MaimemoError } from '../../src/errors.js';
import { redact } from '../../src/redaction.js';

test('授权状态错误均为脱敏的可操作分类', () => {
  for (const code of [
    'AUTH_NOT_CONFIGURED',
    'AUTH_INVALID',
    'AUTH_FORBIDDEN',
    'CREDENTIAL_STORAGE_UNAVAILABLE'
  ] as const) {
    const error = new MaimemoError(code, '访问凭证错误');
    assert.equal(error.code, code);
  }
  assert.deepEqual(
    redact({ token: 'secret', authorization: 'Bearer secret', account: 'private' }),
    {
      token: '[已隐藏]',
      authorization: '[已隐藏]',
      account: 'private'
    }
  );
});
