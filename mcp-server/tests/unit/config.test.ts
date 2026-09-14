import test from 'node:test';
import assert from 'node:assert/strict';
import { assertPageSize, assertWordIds, config } from '../../src/config.js';

test('页大小和词标识有明确边界', () => {
  assert.doesNotThrow(() => assertPageSize(50));
  assert.throws(() => assertPageSize(51));
  assert.doesNotThrow(() => assertWordIds(['a']));
  assert.throws(() => assertWordIds([]));
  assert.equal(config.apiBaseUrl, 'https://open.maimemo.com');
  assert.equal(config.requestTimeoutMs, 10_000);
  assert.equal(config.maxAttempts, 2);
  assert.throws(() => assertWordIds(['', 'word']));
});
