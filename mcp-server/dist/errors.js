export class MaimemoError extends Error {
    code;
    retryAfterSeconds;
    constructor(code, message, retryAfterSeconds) {
        super(message);
        this.code = code;
        this.retryAfterSeconds = retryAfterSeconds;
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
export const toMaimemoError = (error) => {
    if (error instanceof MaimemoError)
        return error;
    const code = error?.code;
    if (typeof code === 'string' && code.startsWith('SQLITE_')) {
        return new MaimemoError('LOCAL_STORE_UNAVAILABLE', '本地学习镜像读写失败，请重试或清理本地数据。', undefined);
    }
    return new MaimemoError('UPSTREAM_UNAVAILABLE', '服务暂时不可用，请稍后重试。');
};
//# sourceMappingURL=errors.js.map