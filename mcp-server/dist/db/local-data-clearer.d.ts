import Database from 'better-sqlite3';
export declare const clearLocalLearningData: (db: Database.Database) => {
    deletedRows: number;
};
export declare const removeDatabaseSidecars: (databasePath: string) => void;
