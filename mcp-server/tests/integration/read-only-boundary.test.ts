import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const readProjectFile = (path: string): string =>
  readFileSync(resolve(process.cwd(), '..', path), 'utf8');

test('墨墨上游适配器只声明读取端点和 POST 读取请求', () => {
  const client = readProjectFile('mcp-server/src/api/maimemo-client.ts');
  const today = readProjectFile('mcp-server/src/api/today-items.ts');
  const records = readProjectFile('mcp-server/src/api/study-records.ts');
  assert.match(client, /method: 'POST'/);
  assert.doesNotMatch(client, /method: '(PUT|PATCH|DELETE)'/);
  assert.doesNotMatch(`${today}\n${records}`, /add_to_plan|update.*study|delete.*memo/i);
});

test('Skill 明确拒绝账号写入，并要求用户在 App 中执行计划修改', () => {
  const skill = readProjectFile('skills/momo-daily-learning/SKILL.md');
  assert.match(skill, /不修改墨墨账号/);
  assert.match(skill, /不支持账号写入/);
  assert.match(skill, /没有对应工具/);
  assert.match(skill, /在 App 内完成/);
});
