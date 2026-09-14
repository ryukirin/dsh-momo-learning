import test from 'node:test';
import assert from 'node:assert/strict';
import { KeyringSecretStore } from '../../src/auth/secret-store.js';
import { MaimemoError } from '../../src/errors.js';

test('安全凭证库不可用时不回退到环境变量或普通文件', () => {
  const store = new KeyringSecretStore(() => {
    throw new Error('unavailable');
  });
  assert.throws(
    () => store.get(),
    (error: unknown) =>
      error instanceof MaimemoError && error.code === 'CREDENTIAL_STORAGE_UNAVAILABLE'
  );
  assert.equal(store.available(), false);
});
