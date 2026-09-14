import { config } from '../config.js';
import { MaimemoError } from '../errors.js';
import { diagnostic } from '../redaction.js';
export class MaimemoClient {
    secrets;
    fetcher;
    requestTimeoutMs;
    constructor(secrets, fetcher = fetch, requestTimeoutMs = config.requestTimeoutMs) {
        this.secrets = secrets;
        this.fetcher = fetcher;
        this.requestTimeoutMs = requestTimeoutMs;
    }
    async post(path, body) {
        const token = this.secrets.get();
        if (!token)
            throw new MaimemoError('AUTH_NOT_CONFIGURED', '尚未配置墨墨访问凭证。');
        if (!path.startsWith('/open/api/v1/')) {
            throw new MaimemoError('INVALID_ARGUMENT', '不允许访问未定义的上游路径。');
        }
        let lastError;
        for (let attempt = 0; attempt < config.maxAttempts; attempt += 1) {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), this.requestTimeoutMs);
            try {
                diagnostic('墨墨读取请求开始。', { path, attempt: attempt + 1 });
                const response = await this.fetcher(`${config.apiBaseUrl}${path}`, {
                    method: 'POST',
                    redirect: 'error',
                    signal: controller.signal,
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify(body)
                });
                diagnostic('墨墨读取响应。', { path, status: response.status });
                if (response.status === 401)
                    throw new MaimemoError('AUTH_INVALID', '墨墨访问凭证无效或已失效。');
                if (response.status === 403)
                    throw new MaimemoError('AUTH_FORBIDDEN', '当前凭证没有所需的读取权限。');
                if (response.status === 429) {
                    const retry = Number(response.headers.get('retry-after') ?? 0) || undefined;
                    throw new MaimemoError('UPSTREAM_RATE_LIMITED', '请求过于频繁，请稍后重试。', retry);
                }
                if (response.status >= 500)
                    throw new MaimemoError('UPSTREAM_UNAVAILABLE', '墨墨服务暂时不可用。');
                if (!response.ok)
                    throw new MaimemoError('UPSTREAM_PROTOCOL_ERROR', '墨墨返回了无法处理的响应。');
                const payload = (await response.json());
                if (payload && typeof payload === 'object' && 'success' in payload) {
                    const wrapped = payload;
                    if (wrapped.success !== true)
                        throw new MaimemoError('UPSTREAM_PROTOCOL_ERROR', '墨墨未确认本次读取请求。');
                    return wrapped.data;
                }
                return payload;
            }
            catch (error) {
                lastError = error;
                diagnostic('墨墨读取请求失败。', {
                    path,
                    attempt: attempt + 1,
                    errorCode: error instanceof MaimemoError ? error.code : 'NETWORK_OR_TIMEOUT'
                });
                if (error instanceof MaimemoError &&
                    [
                        'AUTH_INVALID',
                        'AUTH_FORBIDDEN',
                        'UPSTREAM_RATE_LIMITED',
                        'UPSTREAM_PROTOCOL_ERROR'
                    ].includes(error.code))
                    throw error;
                if (attempt === config.maxAttempts - 1)
                    break;
                await new Promise((resolve) => setTimeout(resolve, 100 + Math.floor(Math.random() * 150)));
            }
            finally {
                clearTimeout(timer);
            }
        }
        if (lastError instanceof DOMException && lastError.name === 'AbortError') {
            throw new MaimemoError('UPSTREAM_TIMEOUT', '墨墨请求超时，请稍后重试。');
        }
        throw new MaimemoError('UPSTREAM_UNAVAILABLE', '无法连接墨墨服务，请稍后重试。');
    }
}
//# sourceMappingURL=maimemo-client.js.map