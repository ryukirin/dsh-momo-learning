import Database from 'better-sqlite3';
export declare class TodoRepository {
    private readonly db;
    constructor(db: Database.Database);
    /**
     * Return whether an active session for the day still serves the caller.
     *
     * A session with entries keeps its progress even when a newer snapshot
     * arrives, so re-syncing never restarts the explanation flow. A session with
     * no entries can only come from a snapshot that carried no words — it can
     * never advance to completion — so a snapshot that does carry words replaces
     * it instead of leaving the day wedged on an empty todo.
     * @param sessionId - the existing active session.
     * @param syncId - the snapshot the caller names.
     * @returns whether to reuse the session as it is.
     */
    private keepsExistingSession;
    open(syncId: string, localDate: string): Record<string, unknown>;
    get(id: string): Record<string, unknown>;
    update(id: string, action: 'mark_understood' | 'skip' | 'pause_current' | 'resume', expected?: string): Record<string, unknown>;
}
