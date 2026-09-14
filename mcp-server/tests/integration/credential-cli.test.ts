import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

test('凭证 CLI 只在 TTY 运行且不会回显输入或写入 SQLite', () => {
  const source = readFileSync(resolve(process.cwd(), 'src/auth/credential-cli.ts'), 'utf8');
  assert.match(source, /stdin\.isTTY/);
  assert.match(source, /stdin\.setRawMode\(true\)/);
  assert.doesNotMatch(source, /stdout\.write\(token\)/);
  assert.doesNotMatch(source, /sqlite|database/i);
});
