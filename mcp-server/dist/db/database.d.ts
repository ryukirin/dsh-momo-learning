import Database from 'better-sqlite3';
export declare const defaultDatabasePath: () => string;
export declare const openDatabase: (path?: string) => Database.Database;
