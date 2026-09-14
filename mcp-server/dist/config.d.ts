export declare const config: {
    readonly apiBaseUrl: "https://open.maimemo.com";
    readonly requestTimeoutMs: 10000;
    readonly maxAttempts: 2;
    readonly localPageSizeMax: 50;
    readonly supplementBatchMax: 50;
    readonly upstreamCollectionMax: 1000;
    readonly previewMax: 50;
    readonly credentialService: "dsh.momo-learning-mcp";
    readonly credentialAccount: "default";
    /** Directory under the user's local app data that holds the mirror database. */
    readonly dataDirectoryName: "MomoLearning";
};
export declare const assertPageSize: (value: number) => void;
export declare const assertWordIds: (ids: string[]) => void;
