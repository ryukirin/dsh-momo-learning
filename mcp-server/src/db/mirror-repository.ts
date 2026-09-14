import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { config } from '../config.js';
import type { Completeness } from '../tools/tool-envelope.js';

export interface WordFact {
  wordId: string;
  spelling: string;
  order?: number;
  isNew?: boolean;
  isFinished?: boolean;
  /** The app's own verdict on this word today, when the read reports one. */
  firstResponse?: string;
}

export interface StudyRecordFact extends WordFact {
  addDate?: string;
  firstStudyDate?: string;
  lastStudyDate?: string;
  nextStudyDate?: string;
  studyCount?: number;
  tags?: string[];
}

/** Scope key of the one-time plan-wide backfill, the only read that can prove coverage. */
export const BACKFILL_SCOPE_KEY = 'backfill:all';

/** Which published study day a local record range narrows. */
export type StudyRecordDateField =
  | 'add_date'
  | 'first_study_date'
  | 'last_study_date'
  | 'next_study_date';

/** One local question about the mirrored study records. */
export interface StudyRecordQuery {
  /** Published day the range applies to; omission returns every word. */
  dateField?: StudyRecordDateField | undefined;
  /** Inclusive Beijing day, `YYYY-MM-DD`. */
  start?: string | undefined;
  /** Inclusive Beijing day, `YYYY-MM-DD`. */
  end?: string | undefined;
  /** Tag values to match; a word matches when any of its tags is listed. */
  tags?: string[] | undefined;
  minStudyCount?: number | undefined;
  maxStudyCount?: number | undefined;
  /** Include words the mirror marked as no longer planned. */
  includeRemoved: boolean;
  pageSize: number;
  offset: number;
}

export class MirrorRepository {
  constructor(private readonly db: Database.Database) {}

  /**
   * Save one day's upstream today-list as a snapshot.
   * @param words - the day's items, in upstream order.
   * @param day - the snapshot's day key, in 墨墨's timezone.
   * @param requestedLocalDate - the local session date the caller named, kept
   * for display; it never keys the snapshot, because the upstream list is
   * scoped to 墨墨's own day rather than this machine's.
   * @returns the new snapshot id and its completeness.
   */
  saveToday(
    words: WordFact[],
    day: string,
    requestedLocalDate: string = day
  ): { syncId: string; completeness: Completeness } {
    const syncId = randomUUID();
    const now = new Date().toISOString();
    const completeness: Completeness = words.length >= 1000 ? 'partial' : 'unknown';
    const save = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO mirror_sync VALUES (?, 'today_snapshot', ?, ?, '墨墨当天项目', 1000, ?, NULL, ?, ?, ?, NULL, ?, ?)`
        )
        .run(
          syncId,
          `today:${day}`,
          requestedLocalDate,
          words.length,
          `上游 order 的前 ${words.length} 项`,
          completeness,
          words.length ? 'success' : 'empty',
          now,
          now
        );
      const word = this.db
        .prepare(`INSERT INTO mirror_word(word_id, spelling, first_seen_at, last_seen_at, plan_state, plan_state_updated_at, latest_sync_id)
        VALUES (?, ?, ?, ?, 'current', ?, ?) ON CONFLICT(word_id) DO UPDATE SET spelling=excluded.spelling,last_seen_at=excluded.last_seen_at,latest_sync_id=excluded.latest_sync_id`);
      const item = this.db.prepare('INSERT INTO today_item VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const value of words) {
        word.run(value.wordId, value.spelling, now, now, now, syncId);
        item.run(
          syncId,
          value.wordId,
          value.order ?? 0,
          value.isNew == null ? null : Number(value.isNew),
          value.isFinished == null ? null : Number(value.isFinished),
          day,
          value.firstResponse ?? null
        );
      }
    });
    save();
    return { syncId, completeness };
  }

  latestToday(): Record<string, unknown> | undefined {
    return this.db
      .prepare(
        `SELECT * FROM mirror_sync WHERE scope_type='today_snapshot' AND outcome IN ('success','empty') ORDER BY finished_at DESC, rowid DESC LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;
  }

  /**
   * List one saved day's words, newest snapshot of that day first.
   *
   * `responses` narrows the list to how the app answered each word, which is what
   * turns the day's list into a practice set: the words answered `FORGET` or
   * `VAGUE` are the ones worth another pass, and re-checking the rest would repeat
   * work the app already did.
   * @param syncId - the snapshot to read.
   * @param pageSize - page size.
   * @param offset - page offset.
   * @param responses - when given, only items whose first response is one of these.
   * @returns the matching items in upstream order.
   */
  listToday(
    syncId: string,
    pageSize: number,
    offset: number,
    responses?: readonly string[]
  ): Record<string, unknown>[] {
    const filter =
      responses === undefined || responses.length === 0
        ? ''
        : ` AND i.first_response IN (${responses.map(() => '?').join(',')})`;
    return this.db
      .prepare(
        `SELECT w.word_id AS wordId,w.spelling,i.upstream_order AS "order",i.is_new AS isNew,i.is_finished AS isFinished,i.first_response AS firstResponse
      FROM today_item i JOIN mirror_word w ON w.word_id=i.word_id WHERE i.sync_id=?${filter} ORDER BY i.upstream_order,i.word_id LIMIT ? OFFSET ?`
      )
      .all(syncId, ...(responses ?? []), pageSize, offset) as Record<string, unknown>[];
  }

  /**
   * Page one saved day's words with the app's own verdict as a filter.
   *
   * `responses` narrows the list to how the app answered each word, and `isNew`
   * separates the words met for the first time today from the ones being reviewed.
   * Together they are what turns the day's list into a practice set: re-asking a
   * word the app already confirmed as known repeats work already done, and a newly
   * learned word and a reviewed word need different questions.
   * @param syncId - the snapshot to read.
   * @param options - verdict filter, new-word filter, and the page.
   * @returns one page in upstream order, with the matching total.
   */
  listTodayPage(
    syncId: string,
    options: {
      responses?: readonly string[] | undefined;
      isNew?: boolean | undefined;
      pageSize: number;
      offset: number;
    }
  ): { words: Record<string, unknown>[]; total: number } {
    const conditions: string[] = [];
    const parameters: (string | number)[] = [];
    if (options.responses !== undefined && options.responses.length > 0) {
      conditions.push(`i.first_response IN (${options.responses.map(() => '?').join(',')})`);
      parameters.push(...options.responses);
    }
    if (options.isNew !== undefined) {
      conditions.push('i.is_new = ?');
      parameters.push(options.isNew ? 1 : 0);
    }
    const where = conditions.length > 0 ? ` AND ${conditions.join(' AND ')}` : '';
    const words = this.db
      .prepare(
        `SELECT w.word_id AS wordId,w.spelling,i.upstream_order AS "order",i.is_new AS isNew,i.is_finished AS isFinished,i.first_response AS firstResponse
         FROM today_item i JOIN mirror_word w ON w.word_id=i.word_id WHERE i.sync_id=?${where}
         ORDER BY i.upstream_order,i.word_id LIMIT ? OFFSET ?`
      )
      .all(syncId, ...parameters, options.pageSize, options.offset) as Record<string, unknown>[];
    const total = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS count FROM today_item i WHERE i.sync_id=?${where}`
        )
        .get(syncId, ...parameters) as { count: number }
    ).count;
    return { words, total };
  }

  /**
   * Count one saved day's words by the app's own verdict.
   * @param syncId - the snapshot to read.
   * @returns one entry per response value seen, including an `unknown` bucket.
   */
  todayResponseCounts(syncId: string): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT COALESCE(first_response, 'unknown') AS response, COUNT(*) AS count
         FROM today_item WHERE sync_id=? GROUP BY response ORDER BY count DESC`
      )
      .all(syncId) as { response: string; count: number }[];
    return Object.fromEntries(rows.map((row) => [row.response, row.count]));
  }

  /**
   * Return when the mirror last observed any study record.
   *
   * This is the evidence a catch-up decision starts from: it says how far the
   * stored records reach, so a gap of whole days is visible before deciding how
   * much to re-read.
   * @returns the newest `observed_at`, or `undefined` when no record is stored.
   */
  latestObservation(): string | undefined {
    const row = this.db.prepare('SELECT MAX(observed_at) AS observedAt FROM study_record').get() as {
      observedAt: string | null;
    };
    return row.observedAt ?? undefined;
  }

  /**
   * Return the newest day a mirrored word was added to the plan.
   *
   * `add_date` is upstream's own "date added", so this says how far the mirror
   * reaches into the plan's growth rather than how recently it was read.
   * @returns the latest `add_date`, or `undefined` when no record is stored.
   */
  latestAddDate(): string | undefined {
    const row = this.db.prepare('SELECT MAX(add_date) AS addedAt FROM study_record').get() as {
      addedAt: string | null;
    };
    return row.addedAt ?? undefined;
  }

  /**
   * Return every word the mirror knows, for local similarity ranking.
   * @returns each stored word's id and spelling.
   */
  allWords(): { wordId: string; spelling: string }[] {
    return this.db.prepare('SELECT word_id AS wordId, spelling FROM mirror_word').all() as {
      wordId: string;
      spelling: string;
    }[];
  }

  /**
   * Record the words a local quiz got wrong.
   *
   * Only mistakes are kept, one row per word ever missed: a repeated mistake
   * raises `miss_count` and moves `last_missed_day` instead of appending another
   * row, so the table is a worklist rather than an attempt transcript. A word
   * answered correctly is only ever written when it clears an existing mistake.
   * @param day - the Beijing day of the quiz.
   * @param mistakes - the words answered wrong, with what was asked.
   * @returns how many rows were new and how many were repeats.
   */
  saveQuizMistakes(
    day: string,
    mistakes: readonly {
      wordId: string;
      spelling: string;
      prompt?: string | undefined;
      type?: string | undefined;
    }[]
  ): { added: number; repeated: number } {
    const existing = this.db.prepare('SELECT word_id FROM quiz_mistake WHERE word_id=?');
    // Register the word first, as every other write path does: a mistake must
    // never be lost because the word had not been mirrored yet.
    const word = this.db.prepare(
      `INSERT INTO mirror_word(word_id,spelling,first_seen_at,last_seen_at,plan_state,plan_state_updated_at,latest_sync_id)
       VALUES(?,?,?,?,'current',?,NULL) ON CONFLICT(word_id) DO UPDATE SET spelling=excluded.spelling,last_seen_at=excluded.last_seen_at`
    );
    const upsert = this.db.prepare(
      `INSERT INTO quiz_mistake(word_id,spelling,first_missed_day,last_missed_day,miss_count,last_prompt,last_type,cleared_day)
       VALUES(?,?,?,?,1,?,?,NULL)
       ON CONFLICT(word_id) DO UPDATE SET
         spelling=excluded.spelling,
         last_missed_day=excluded.last_missed_day,
         miss_count=quiz_mistake.miss_count + 1,
         last_prompt=excluded.last_prompt,
         last_type=excluded.last_type,
         cleared_day=NULL`
    );
    const now = new Date().toISOString();
    let added = 0;
    let repeated = 0;
    this.db.transaction(() => {
      for (const mistake of mistakes) {
        const seen = existing.get(mistake.wordId) !== undefined;
        word.run(mistake.wordId, mistake.spelling, now, now, now);
        upsert.run(
          mistake.wordId,
          mistake.spelling,
          day,
          day,
          mistake.prompt ?? null,
          mistake.type ?? null
        );
        if (seen) repeated += 1;
        else added += 1;
      }
    })();
    return { added, repeated };
  }

  /**
   * Mark a mistake as cleared because the word was answered correctly.
   * @param wordId - the word answered correctly.
   * @param day - the Beijing day it was answered correctly.
   * @returns whether a mistake row was cleared.
   */
  clearQuizMistake(wordId: string, day: string): boolean {
    const result = this.db
      .prepare('UPDATE quiz_mistake SET cleared_day=? WHERE word_id=? AND cleared_day IS NULL')
      .run(day, wordId);
    return result.changes > 0;
  }

  /**
   * List the mistake book, most-missed first.
   * @param options - whether to include cleared words, and the page.
   * @returns one page of mistakes and the matching total.
   */
  listQuizMistakes(options: {
    includeCleared: boolean;
    pageSize: number;
    offset: number;
  }): { words: Record<string, unknown>[]; total: number } {
    const where = options.includeCleared ? '' : 'WHERE cleared_day IS NULL';
    const words = this.db
      .prepare(
        `SELECT word_id AS wordId, spelling, first_missed_day AS firstMissedDay,
                last_missed_day AS lastMissedDay, miss_count AS missCount,
                last_prompt AS lastPrompt, last_type AS lastType, cleared_day AS clearedDay
         FROM quiz_mistake ${where}
         ORDER BY miss_count DESC, last_missed_day DESC, word_id
         LIMIT ? OFFSET ?`
      )
      .all(options.pageSize, options.offset) as Record<string, unknown>[];
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS count FROM quiz_mistake ${where}`).get() as {
        count: number;
      }
    ).count;
    return { words, total };
  }

  /** Count the mistake book by state, for the day's report. */
  quizMistakeSummary(): { open: number; cleared: number } {
    const row = this.db
      .prepare(
        `SELECT SUM(cleared_day IS NULL) AS open, SUM(cleared_day IS NOT NULL) AS cleared FROM quiz_mistake`
      )
      .get() as { open: number | null; cleared: number | null };
    return { open: row.open ?? 0, cleared: row.cleared ?? 0 };
  }

  /**
   * Pick the day's quiz candidates from the whole mirror, least-known first.
   *
   * The pool is the plan rather than today's list: a word just learned is still in
   * short-term memory, so quizzing it tests nothing, while a word met a while ago
   * and partly forgotten is exactly what retrieval practice is for. Three rules do
   * that — never study a word twice in one day, skip words first met today, and
   * prefer a real gap since the word was last seen — with today's misses kept as
   * an explicit exception, because "reviewed it today and still got it wrong" is
   * the strongest signal the app can give.
   * @param options - how many words, the minimum gap, and today's Beijing day.
   * @returns the ranked candidates, each carrying the reason it was chosen.
   */
  listQuizCandidates(options: {
    limit: number;
    minDaysSinceStudy: number;
    day: string;
  }): { words: Record<string, unknown>[]; total: number } {
    const today = this.latestToday();
    const todaySyncId = today === undefined ? '' : String(today.id);
    const gapCutoff = new Date(Date.parse(`${options.day}T00:00:00Z`) - options.minDaysSinceStudy * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const where = `
      word.plan_state = 'current'
      AND record.last_study_date IS NOT NULL
      AND COALESCE(today.is_new, 0) = 0
      AND (record.last_study_date <= ? OR today.first_response IN ('FORGET', 'VAGUE'))`;
    // Tier first, then the longest gap since the word was last seen: a word met a
    // while ago and not since is the one worth retrieving.
    const tier = `
      CASE
        WHEN mistake.word_id IS NOT NULL THEN 500
        WHEN record.tags LIKE '%STICKING%' THEN 400
        WHEN today.first_response = 'FORGET' THEN 300
        WHEN today.first_response = 'VAGUE' THEN 200
        WHEN record.study_count <= 2 THEN 100
        ELSE 0
      END`;
    const from = `
      FROM study_record record
      JOIN mirror_word word ON word.word_id = record.word_id
      LEFT JOIN quiz_mistake mistake ON mistake.word_id = record.word_id AND mistake.cleared_day IS NULL
      LEFT JOIN today_item today ON today.word_id = record.word_id AND today.sync_id = ?`;
    const words = this.db
      .prepare(
        `SELECT record.word_id AS wordId, word.spelling,
                record.last_study_date AS lastStudyDate, record.next_study_date AS nextStudyDate,
                record.study_count AS studyCount, record.tags AS tags,
                COALESCE(mistake.miss_count, 0) AS missCount,
                today.first_response AS todayResponse,
                ${tier} AS tier,
                CASE
                  WHEN mistake.word_id IS NOT NULL THEN '本地错题'
                  WHEN record.tags LIKE '%STICKING%' THEN '墨墨标记顽固'
                  WHEN today.first_response = 'FORGET' THEN '今天复习忘记'
                  WHEN today.first_response = 'VAGUE' THEN '今天复习模糊'
                  WHEN record.study_count <= 2 THEN '学得少'
                  ELSE '间隔较久'
                END AS reason
         ${from}
         WHERE ${where}
         ORDER BY tier DESC, record.last_study_date ASC, record.word_id
         LIMIT ?`
      )
      .all(todaySyncId, gapCutoff, options.limit) as Record<string, unknown>[];
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS count ${from} WHERE ${where}`).get(todaySyncId, gapCutoff) as {
        count: number;
      }
    ).count;
    return { words, total };
  }

  /**
   * Record that a plan-wide walk proved it covered the whole plan.
   *
   * Each page of a backfill is a slice and is saved as partial, so the walk's
   * proven coverage needs its own row. It carries no membership, so it can never
   * take part in the removal rule.
   * @param covered - distinct words the walk saw.
   * @param knownTotal - upstream's own total for the plan.
   * @returns the new sync id.
   */
  recordPlanCoverage(covered: number, knownTotal: number): string {
    const syncId = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO mirror_sync VALUES (?, 'study_record_window', ?, NULL, '整个计划的学习记录', ?, ?, ?, '全量回填', 'complete', 'success', NULL, ?, ?)`
      )
      .run(syncId, BACKFILL_SCOPE_KEY, covered, covered, knownTotal, now, now);
    return syncId;
  }

  /**
   * Return the newest read that proved the mirror covers the whole plan.
   *
   * The daily incremental refresh is a by-word slice and can never claim
   * completeness, so reporting the freshest read's status alone would label a
   * fully backfilled mirror as only partially covered. This is the row a local
   * query cites for coverage; the freshest read separately shows how current the
   * stored rows are.
   * @returns the newest complete plan-wide read, or `undefined` when none ran.
   */
  planCoverage(): Record<string, unknown> | undefined {
    return this.db
      .prepare(
        `SELECT * FROM mirror_sync
         WHERE scope_type='study_record_window' AND scope_key=? AND completeness='complete' AND outcome='success'
         ORDER BY finished_at DESC, rowid DESC LIMIT 1`
      )
      .get(BACKFILL_SCOPE_KEY) as Record<string, unknown> | undefined;
  }

  /**
   * Return the freshest study-record read, whatever its scope.
   *
   * `finished_at` has millisecond resolution, so a same-millisecond pair of reads
   * needs `rowid` to break the tie; without it the "latest" read would be
   * whichever the query planner happened to return first.
   */
  latestStudyWindow(): Record<string, unknown> | undefined {
    return this.db
      .prepare(
        `SELECT * FROM mirror_sync WHERE scope_type='study_record_window' AND outcome IN ('success','empty') ORDER BY finished_at DESC, rowid DESC LIMIT 1`
      )
      .get() as Record<string, unknown> | undefined;
  }

  listPlanning(
    scope: 'current_planning' | 'removed_history',
    includeRemoved: boolean,
    pageSize: number,
    offset: number
  ): { words: Record<string, unknown>[]; total: number } {
    const clause =
      scope === 'removed_history'
        ? "plan_state='removed_from_current_plan'"
        : includeRemoved
          ? "plan_state IN ('current','removed_from_current_plan')"
          : "plan_state='current'";
    const words = this.db
      .prepare(
        `SELECT word_id AS wordId,spelling,plan_state AS planState FROM mirror_word WHERE ${clause} ORDER BY spelling LIMIT ? OFFSET ?`
      )
      .all(pageSize, offset) as Record<string, unknown>[];
    const total = (
      this.db.prepare(`SELECT COUNT(*) AS count FROM mirror_word WHERE ${clause}`).get() as {
        count: number;
      }
    ).count;
    return { words, total };
  }

  saveStudyWindow(
    words: StudyRecordFact[],
    scopeKey: string,
    knownTotal: number | undefined,
    sourceLimit: number = config.upstreamCollectionMax
  ): { syncId: string; completeness: Completeness } {
    const syncId = randomUUID();
    const now = new Date().toISOString();
    const completeness: Completeness =
      words.length >= sourceLimit
        ? 'partial'
        : knownTotal === words.length
          ? 'complete'
          : 'unknown';
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO mirror_sync VALUES (?, 'study_record_window', ?, NULL, '北京时间的下次学习日期', ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
        )
        .run(
          syncId,
          scopeKey,
          sourceLimit,
          words.length,
          knownTotal ?? null,
          scopeKey,
          completeness,
          words.length ? 'success' : 'empty',
          now,
          now
        );
      const word = this.db
        .prepare(`INSERT INTO mirror_word(word_id,spelling,first_seen_at,last_seen_at,plan_state,plan_state_updated_at,latest_sync_id)
        VALUES(?,?,?,?,'current',?,?) ON CONFLICT(word_id) DO UPDATE SET spelling=excluded.spelling,last_seen_at=excluded.last_seen_at,plan_state='current',plan_state_updated_at=excluded.plan_state_updated_at,latest_sync_id=excluded.latest_sync_id`);
      const member = this.db.prepare('INSERT INTO study_window_member(sync_id,word_id) VALUES(?,?)');
      const record = this.db.prepare(
        `INSERT INTO study_record(word_id,add_date,first_study_date,last_study_date,next_study_date,study_count,tags,observed_at,latest_sync_id)
        VALUES(?,?,?,?,?,?,?,?,?)
        ON CONFLICT(word_id) DO UPDATE SET
          add_date=excluded.add_date,
          first_study_date=excluded.first_study_date,
          last_study_date=excluded.last_study_date,
          next_study_date=excluded.next_study_date,
          study_count=excluded.study_count,
          tags=excluded.tags,
          observed_at=excluded.observed_at,
          latest_sync_id=excluded.latest_sync_id`
      );
      for (const value of words) {
        word.run(value.wordId, value.spelling, now, now, now, syncId);
        member.run(syncId, value.wordId);
        record.run(
          value.wordId,
          value.addDate ?? null,
          value.firstStudyDate ?? null,
          value.lastStudyDate ?? null,
          value.nextStudyDate ?? null,
          value.studyCount ?? null,
          value.tags ? JSON.stringify(value.tags) : null,
          now,
          syncId
        );
      }
      // 只有同一学习记录范围此前出现、但本次完整成功同步中缺失的词，才能标为移出。
      // 当天快照和其他范围的词不会参与比较；不完整、未知或失败同步绝不能改变既有规划状态。
      if (completeness === 'complete') {
        this.db
          .prepare(
            `UPDATE mirror_word
             SET plan_state='removed_from_current_plan', plan_state_updated_at=?
             WHERE plan_state='current'
               AND word_id IN (
                 SELECT previous_member.word_id
                 FROM study_window_member previous_member
                 JOIN mirror_sync previous_sync ON previous_sync.id=previous_member.sync_id
                 WHERE previous_sync.scope_type='study_record_window'
                   AND previous_sync.scope_key=?
                   AND previous_sync.id<>?
               )
               AND word_id NOT IN (SELECT word_id FROM study_window_member WHERE sync_id=?)`
          )
          .run(now, scopeKey, syncId, syncId);
      }
    })();
    return { syncId, completeness };
  }

  /**
   * Answer one local question about mirrored study records.
   *
   * Every filter applies to rows the mirror already holds, so building a quiz
   * from history never calls upstream. `dateField` selects which of the four
   * published days the range narrows, and tags are compared element-wise against
   * the stored JSON array instead of by substring, so `STICKING` cannot match an
   * unrelated tag that merely contains it.
   * @param filter - the local filter and page.
   * @returns one page of matching words, newest day first, and the matching total.
   */
  queryRecords(filter: StudyRecordQuery): { words: Record<string, unknown>[]; total: number } {
    const conditions: string[] = [];
    const parameters: (string | number)[] = [];
    if (filter.dateField !== undefined) {
      if (filter.start !== undefined) {
        conditions.push(`record.${filter.dateField} >= ?`);
        parameters.push(filter.start);
      }
      if (filter.end !== undefined) {
        conditions.push(`record.${filter.dateField} <= ?`);
        parameters.push(filter.end);
      }
    }
    if (filter.tags !== undefined && filter.tags.length > 0) {
      conditions.push(
        `EXISTS (SELECT 1 FROM json_each(record.tags) WHERE json_each.value IN (${filter.tags
          .map(() => '?')
          .join(',')}))`
      );
      parameters.push(...filter.tags);
    }
    if (filter.minStudyCount !== undefined) {
      conditions.push('record.study_count >= ?');
      parameters.push(filter.minStudyCount);
    }
    if (filter.maxStudyCount !== undefined) {
      conditions.push('record.study_count <= ?');
      parameters.push(filter.maxStudyCount);
    }
    if (!filter.includeRemoved) conditions.push("word.plan_state = 'current'");
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const order = filter.dateField ?? 'last_study_date';
    const words = this.db
      .prepare(
        `SELECT record.word_id AS wordId, word.spelling,
                record.add_date AS addDate, record.first_study_date AS firstStudyDate,
                record.last_study_date AS lastStudyDate, record.next_study_date AS nextStudyDate,
                record.study_count AS studyCount, record.tags AS tags,
                record.observed_at AS observedAt, word.plan_state AS planState
         FROM study_record record JOIN mirror_word word ON word.word_id = record.word_id
         ${where}
         ORDER BY record.${order} DESC, record.word_id
         LIMIT ? OFFSET ?`
      )
      .all(...parameters, filter.pageSize, filter.offset) as Record<string, unknown>[];
    const total = (
      this.db
        .prepare(
          `SELECT COUNT(*) AS count
           FROM study_record record JOIN mirror_word word ON word.word_id = record.word_id
           ${where}`
        )
        .get(...parameters) as { count: number }
    ).count;
    return { words, total };
  }
}
