import test from 'node:test';
import assert from 'node:assert/strict';
import { envelope } from '../../src/tools/tool-envelope.js';

test('工具 envelope 固定声明无远端续页，空结果仍是成功响应', () => {
  const output = envelope({ words: [] }, 'local_mirror', 'unknown', ['尚无本地镜像。']);
  assert.deepEqual(output, {
    data: { words: [] },
    source: 'local_mirror',
    mirror: {},
    completeness: { status: 'unknown', continuationAvailable: false },
    warnings: ['尚无本地镜像。']
  });
  assert.equal('cursor' in output.completeness, false);
});

test('工具 envelope 保留明确的镜像证据而不注入远端分页信息', () => {
  const output = envelope({ count: 1 }, 'upstream', 'partial', [], {
    snapshotId: 'local-only-id',
    sourceLimit: 1000
  });
  assert.deepEqual(output.mirror, { snapshotId: 'local-only-id', sourceLimit: 1000 });
  assert.deepEqual(output.completeness, { status: 'partial', continuationAvailable: false });
});
