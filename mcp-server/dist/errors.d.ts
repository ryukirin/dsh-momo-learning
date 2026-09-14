export type ErrorCode = 'INVALID_ARGUMENT' | 'AUTH_NOT_CONFIGURED' | 'AUTH_INVALID' | 'AUTH_FORBIDDEN' | 'CREDENTIAL_STORAGE_UNAVAILABLE' | 'UPSTREAM_RATE_LIMITED' | 'UPSTREAM_TIMEOUT' | 'UPSTREAM_UNAVAILABLE' | 'UPSTREAM_PROTOCOL_ERROR' | 'LOCAL_STORE_UNAVAILABLE' | 'TODO_NOT_FOUND' | 'TODO_STATE_CONFLICT' | 'CONFIRMATION_REQUIRED' | 'UNSUPPORTED_CAPABILITY';
export declare class MaimemoError extends Error {
    readonly code: ErrorCode;
    readonly retryAfterSeconds?: number | undefined;
    constructor(code: ErrorCode, message: string, retryAfterSeconds?: number | undefined);
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
export declare const toMaimemoError: (error: unknown) => MaimemoError;
