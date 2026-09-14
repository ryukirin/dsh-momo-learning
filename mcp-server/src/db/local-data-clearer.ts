import { existsSync, rmSync } from 'node:fs';
import Database from 'better-sqlite3';

export const clearLocalLearningData = (db: Database.Database): { deletedRows: number } => {
  const tables = [
    'todo_entry',
    'todo_session',
    'word_supplement',
    'study_record',
    'today_item',
    'mirror_word',
    'mirror_sync',
    'capability_flag'
  ];
  const transaction = db.transaction(() => {
    let deletedRows = 0;
    for (const table of tables) {
      deletedRows += db.prepare(`DELETE FROM ${table}`).run().changes;
    }
    return deletedRows;
  });
  return { deletedRows: transaction() };
};

export const removeDatabaseSidecars = (databasePath: string): void => {
  for (const path of [`${databasePath}-wal`, `${databasePath}-shm`]) {
    if (existsSync(path)) rmSync(path, { force: true });
  }
};
