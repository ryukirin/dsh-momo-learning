import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('stdio 服务可被 MCP 客户端发现，诊断信息不污染协议输出', async () => {
  const localAppData = mkdtempSync(join(tmpdir(), 'momo-mcp-test-'));
  let diagnostics = '';
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['--import', 'tsx', 'src/server.ts'],
    cwd: process.cwd(),
    env: { ...(process.env as Record<string, string>), LOCALAPPDATA: localAppData },
    stderr: 'pipe'
  });
  transport.stderr?.setEncoding('utf8');
  transport.stderr?.on('data', (chunk: string) => {
    diagnostics += chunk;
  });
  const client = new Client({ name: 'stdio-contract-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [
      'maimemo_auth_status',
      'maimemo_backfill_study_records',
      'maimemo_clear_local_learning_data',
      'maimemo_find_similar_words',
      'maimemo_get_daily_todo',
      'maimemo_get_day_state',
      'maimemo_get_learning_overview',
      'maimemo_get_word_supplements',
      'maimemo_list_local_words',
      'maimemo_list_quiz_candidates',
      'maimemo_list_quiz_mistakes',
      'maimemo_open_daily_todo',
      'maimemo_query_local_records',
      'maimemo_record_quiz_mistakes',
      'maimemo_refresh_study_records',
      'maimemo_sync_study_record_window',
      'maimemo_sync_today_snapshot',
      'maimemo_sync_word_supplements',
      'maimemo_update_daily_todo'
    ]);
    const requiredArguments = {
      maimemo_auth_status: {},
      maimemo_get_learning_overview: {},
      maimemo_sync_today_snapshot: { reason: 'user_requested' },
      maimemo_list_local_words: { scope: 'today_snapshot' },
      maimemo_open_daily_todo: { sourceSnapshotId: 'ignored', localSessionDate: '2026-09-13' },
      maimemo_get_daily_todo: { todoId: 'ignored' },
      maimemo_update_daily_todo: { todoId: 'ignored', action: 'skip' },
      maimemo_sync_study_record_window: {
        start: '2026-09-13',
        end: '2026-09-14',
        reason: 'user_requested'
      },
      maimemo_sync_word_supplements: { wordIds: ['ignored'], reason: 'user_requested' },
      maimemo_get_word_supplements: { wordIds: ['ignored'] },
      maimemo_clear_local_learning_data: {
        scope: 'all_local_learning_data',
        confirm: false
      },
      maimemo_query_local_records: {},
      maimemo_list_quiz_candidates: {},
      maimemo_refresh_study_records: {},
      maimemo_get_day_state: {},
      maimemo_find_similar_words: { spelling: 'ignored' },
      maimemo_record_quiz_mistakes: {},
      maimemo_list_quiz_mistakes: {},
      maimemo_backfill_study_records: {}
    } as const;
    for (const [name, arguments_] of Object.entries(requiredArguments)) {
      const invalid = await client.callTool({
        name,
        arguments: {
          ...arguments_,
          untrustedUrl: 'https://example.invalid',
          token: 'must-not-be-accepted'
        }
      });
      assert.equal(invalid.isError, true, `${name} 必须拒绝未声明参数。`);
    }
  } finally {
    await transport.close();
    rmSync(localAppData, { force: true, recursive: true });
  }
  assert.match(diagnostics, /stdio/);
});
