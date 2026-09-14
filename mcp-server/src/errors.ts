export type ErrorCode =
  | 'INVALID_ARGUMENT'
  | 'AUTH_NOT_CONFIGURED'
  | 'AUTH_INVALID'
  | 'AUTH_FORBIDDEN'
  | 'CREDENTIAL_STORAGE_UNAVAILABLE'
  | 'UPSTREAM_RATE_LIMITED'
  | 'UPSTREAM_TIMEOUT'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_PROTOCOL_ERROR'
  | 'LOCAL_STORE_UNAVAILABLE'
  | 'TODO_NOT_FOUND'
  | 'TODO_STATE_CONFLICT'
  | 'CONFIRMATION_REQUIRED'
  | 'UNSUPPORTED_CAPABILITY';

export class MaimemoError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
    this.name = 'MaimemoError';
  }
}

/**
 * Classify an error thrown by a tool body.
 *
 * A failure in the local mirror is not an upstream outage, so a SQLite error
 * keeps its own code: reporting it as `UPSTREAM_UNAVAILABLE` told the user to
 * retry against 墨墨 while the actual fault — and the actual fix — were local.
 * @param error - the thrown value.
 * @returns the classified error, unchanged when it already is one.
 */
export const toMaimemoError = (error: unknown): MaimemoError => {
  if (error instanceof MaimemoError) return error;
  const code = (error as { code?: unknown } | null | undefined)?.code;
  if (typeof code === 'string' && code.startsWith('SQLITE_')) {
    return new MaimemoError('LOCAL_STORE_UNAVAILABLE', '本地学习镜像读写失败，请重试或清理本地数据。', undefined);
  }
  return new MaimemoError('UPSTREAM_UNAVAILABLE', '服务暂时不可用，请稍后重试。');
};
