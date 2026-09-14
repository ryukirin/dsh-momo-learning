import type { SecretStore } from '../auth/secret-store.js';
type FetchLike = typeof fetch;
export declare class MaimemoClient {
    private readonly secrets;
    private readonly fetcher;
    private readonly requestTimeoutMs;
    constructor(secrets: SecretStore, fetcher?: FetchLike, requestTimeoutMs?: 10000);
    post<T>(path: string, body: Record<string, unknown>): Promise<T>;
}
export {};
