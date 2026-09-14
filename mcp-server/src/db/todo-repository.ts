import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { MaimemoError } from '../errors.js';

export class TodoRepository {
  constructor(private readonly db: Database.Database) {}

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
  private keepsExistingSession(sessionId: string, syncId: string): boolean {
    const entries = (
      this.db.prepare('SELECT COUNT(*) AS count FROM todo_entry WHERE session_id=?').get(sessionId) as {
        count: number;
      }
    ).count;
    if (entries > 0) return true;
    const items = (
      this.db.prepare('SELECT COUNT(*) AS count FROM today_item WHERE sync_id=?').get(syncId) as {
        count: number;
      }
    ).count;
    return items === 0;
  }

  open(syncId: string, localDate: string): Record<string, unknown> {
    const existing = this.db
      .prepare(
        `SELECT id FROM todo_session WHERE local_session_date=? AND status='active' ORDER BY updated_at DESC LIMIT 1`
      )
      .get(localDate) as { id?: string } | undefined;
    if (existing?.id && this.keepsExistingSession(existing.id, syncId)) return this.get(existing.id);
    const snapshot = this.db
      .prepare("SELECT id FROM mirror_sync WHERE id=? AND scope_type='today_snapshot'")
      .get(syncId) as { id?: string } | undefined;
    if (!snapshot?.id)
      throw new MaimemoError('INVALID_ARGUMENT', '待办只能基于已保存的当天快照创建。');
    const items = this.db
      .prepare(
        'SELECT word_id,upstream_order FROM today_item WHERE sync_id=? ORDER BY upstream_order,word_id'
      )
      .all(syncId) as { word_id: string; upstream_order: number }[];    const id = randomUUID();
    const now = new Date().toISOString();
    const entryIds = items.map(() => randomUUID());
    this.db.transaction(() => {
      if (existing?.id)
        this.db
          .prepare("UPDATE todo_session SET status='abandoned',updated_at=? WHERE id=?")
          .run(now, existing.id);
      this.db
        .prepare(
          `INSERT INTO todo_session(id,source_sync_id,local_session_date,current_entry_id,paused_entry_id,status,created_at,updated_at) VALUES(?,?,?,?,?,'active',?,?)`
        )
        .run(id, syncId, localDate, entryIds[0] ?? null, null, now, now);
      const insert = this.db.prepare('INSERT INTO todo_entry VALUES(?,?,?,?,?,?)');
      items.forEach((item, index) =>
        insert.run(entryIds[index], id, item.upstream_order, item.word_id, 'pending', now)
      );
    })();
    return this.get(id);
  }
  get(id: string): Record<string, unknown> {
    const session = this.db.prepare('SELECT * FROM todo_session WHERE id=?').get(id) as
      Record<string, unknown> | undefined;
    if (!session) throw new MaimemoError('TODO_NOT_FOUND', '未找到当日待办。');
    const entries = this.db
      .prepare(
        `SELECT e.*,w.spelling FROM todo_entry e JOIN mirror_word w ON w.word_id=e.word_id WHERE e.session_id=? ORDER BY e.upstream_order,e.word_id`
      )
      .all(id);
    return { ...session, entries };
  }
  update(
    id: string,
    action: 'mark_understood' | 'skip' | 'pause_current' | 'resume',
    expected?: string
  ): Record<string, unknown> {
    const session = this.db.prepare('SELECT * FROM todo_session WHERE id=?').get(id) as
      { current_entry_id: string | null; paused_entry_id: string | null } | undefined;
    if (!session) throw new MaimemoError('TODO_NOT_FOUND', '未找到当日待办。');
    if (expected && expected !== session.current_entry_id)
      throw new MaimemoError('TODO_STATE_CONFLICT', '当前待办已发生变化，请重新读取后再操作。');
    const now = new Date().toISOString();
    if (action === 'pause_current') {
      if (!session.current_entry_id)
        throw new MaimemoError('TODO_STATE_CONFLICT', '当前没有可暂停的待办项。');
      this.db.transaction(() => {
        this.db
          .prepare("UPDATE todo_entry SET status='paused',updated_at=? WHERE id=?")
          .run(now, session.current_entry_id);
        this.db
          .prepare(
            'UPDATE todo_session SET current_entry_id=NULL,paused_entry_id=?,updated_at=? WHERE id=?'
          )
          .run(session.current_entry_id, now, id);
      })();
    } else if (action === 'resume') {
      if (!session.paused_entry_id)
        throw new MaimemoError('TODO_STATE_CONFLICT', '没有可恢复的暂停待办项。');
      this.db.transaction(() => {
        this.db
          .prepare("UPDATE todo_entry SET status='pending',updated_at=? WHERE id=?")
          .run(now, session.paused_entry_id);
        this.db
          .prepare(
            'UPDATE todo_session SET current_entry_id=paused_entry_id,paused_entry_id=NULL,updated_at=? WHERE id=?'
          )
          .run(now, id);
      })();
    } else if (session.current_entry_id)
      this.db.transaction(() => {
        this.db
          .prepare('UPDATE todo_entry SET status=?,updated_at=? WHERE id=?')
          .run(action === 'skip' ? 'skipped' : 'understood', now, session.current_entry_id);
        // `order` is a study sequence, not an identity — upstream publishes the
        // same order for several items — so advancing compares the whole sort
        // key `(upstream_order, word_id)`. Comparing `upstream_order` alone
        // would jump over an entry that shares the current item's order.
        const next = this.db
          .prepare(
            `SELECT id FROM todo_entry WHERE session_id=? AND status='pending' AND (upstream_order,word_id) > (SELECT upstream_order,word_id FROM todo_entry WHERE id=?) ORDER BY upstream_order,word_id LIMIT 1`
          )
          .get(id, session.current_entry_id) as { id?: string } | undefined;
        this.db
          .prepare('UPDATE todo_session SET current_entry_id=?,status=?,updated_at=? WHERE id=?')
          .run(next?.id ?? null, next?.id ? 'active' : 'completed', now, id);
      })();
    return this.get(id);
  }
}
