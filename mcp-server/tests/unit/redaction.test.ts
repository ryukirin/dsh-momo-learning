import test from 'node:test';
import assert from 'node:assert/strict';
import { redact } from '../../src/redaction.js';

test('隐藏令牌和授权请求头', () => {
  const output = JSON.stringify(
    redact({ token: 'secret-value', authorization: 'Bearer abc', message: 'Bearer xyz' })
  );
  assert.equal(output.includes('secret-value'), false);
  assert.equal(output.includes('Bearer abc'), false);
  assert.equal(output.includes('Bearer xyz'), false);
});
