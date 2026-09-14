import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertWordIds } from '../../src/config.js';

test('用户自建补充限制为 1..50 个词，未确认能力不伪装为词典', () => {
  assert.doesNotThrow(() => assertWordIds(['one']));
  assert.throws(() => assertWordIds(Array.from({ length: 51 }, (_, index) => String(index))));
  const tools = readFileSync(resolve(process.cwd(), 'src/tools/register-tools.ts'), 'utf8');
  assert.match(tools, /UNSUPPORTED_CAPABILITY/);
  assert.match(tools, /source/);
});
