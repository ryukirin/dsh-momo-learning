export type Completeness = 'complete' | 'partial' | 'unknown';
export declare const envelope: <T>(data: T, source: "upstream" | "local_mirror", completeness?: Completeness, warnings?: string[], mirror?: Record<string, unknown>) => {
    data: T;
    source: "upstream" | "local_mirror";
    mirror: Record<string, unknown>;
    completeness: {
        status: Completeness;
        continuationAvailable: boolean;
    };
    warnings: string[];
};
