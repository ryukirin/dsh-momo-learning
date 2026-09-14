import Database from 'better-sqlite3';
/**
 * Local mirror schema version recorded in `schema_migration` after a successful
 * migration.
 *
 * - Version 2 removed the `UNIQUE(... , upstream_order)` constraints that
 *   version 1 put on `today_item` and `todo_entry`.
 * - Version 3 normalized every stored date to 墨墨's calendar day.
 * - Version 4 made `study_record` one row per word — the mirror is the source a
 *   quiz is built from, so a word must never be duplicated by a later sync —
 *   and moved per-sync membership into `study_window_member`.
 * - Version 5 stored the day's first response, which is what narrows a quiz to
 *   the words the app already showed were not yet known.
 * - Version 6 added `quiz_mistake`, the only local record the quiz keeps: one row
 *   per word ever answered wrong, never a per-attempt transcript.
 */
export declare const schemaVersion = 6;
export declare const migrate: (db: Database.Database) => void;
