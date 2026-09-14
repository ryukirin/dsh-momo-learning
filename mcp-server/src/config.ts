import { MaimemoError } from './errors.js';

export const config = {
  apiBaseUrl: 'https://open.maimemo.com',
  requestTimeoutMs: 10_000,
  maxAttempts: 2,
  localPageSizeMax: 50,
  supplementBatchMax: 50,
  upstreamCollectionMax: 1_000,
  previewMax: 50,
  credentialService: 'dsh.momo-learning-mcp',
  credentialAccount: 'default',
  /** Directory under the user's local app data that holds the mirror database. */
  dataDirectoryName: 'MomoLearning'
} as const;

export const assertPageSize = (value: number): void => {
  if (!Number.isInteger(value) || value < 1 || value > config.localPageSizeMax) {
    throw new MaimemoError('INVALID_ARGUMENT', '页大小必须是 1 到 50 之间的整数。');
  }
};

export const assertWordIds = (ids: string[]): void => {
  if (ids.length === 0 || ids.length > config.supplementBatchMax || ids.some((id) => !id.trim())) {
    throw new MaimemoError('INVALID_ARGUMENT', '单词标识数量必须在 1 到 50 之间。');
  }
};
