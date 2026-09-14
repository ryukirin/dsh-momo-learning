import Database from 'better-sqlite3';
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
export declare const BACKFILL_SCOPE_KEY = "backfill:all";
/** Which published study day a local record range narrows. */
export type StudyRecordDateField = 'add_date' | 'first_study_date' | 'last_study_date' | 'next_study_date';
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
export declare class MirrorRepository {
    private readonly db;
    constructor(db: Database.Database);
    /**
     * Save one day's upstream today-list as a snapshot.
     * @param words - the day's items, in upstream order.
     * @param day - the snapshot's day key, in 墨墨's timezone.
     * @param requestedLocalDate - the local session date the caller named, kept
     * for display; it never keys the snapshot, because the upstream list is
     * scoped to 墨墨's own day rather than this machine's.
     * @returns the new snapshot id and its completeness.
     */
    saveToday(words: WordFact[], day: string, requestedLocalDate?: string): {
        syncId: string;
        completeness: Completeness;
    };
    latestToday(): Record<string, unknown> | undefined;
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
    listToday(syncId: string, pageSize: number, offset: number, responses?: readonly string[]): Record<string, unknown>[];
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
    listTodayPage(syncId: string, options: {
        responses?: readonly string[] | undefined;
        isNew?: boolean | undefined;
        pageSize: number;
        offset: number;
    }): {
        words: Record<string, unknown>[];
        total: number;
    };
    /**
     * Count one saved day's words by the app's own verdict.
     * @param syncId - the snapshot to read.
     * @returns one entry per response value seen, including an `unknown` bucket.
     */
    todayResponseCounts(syncId: string): Record<string, number>;
    /**
     * Return when the mirror last observed any study record.
     *
     * This is the evidence a catch-up decision starts from: it says how far the
     * stored records reach, so a gap of whole days is visible before deciding how
     * much to re-read.
     * @returns the newest `observed_at`, or `undefined` when no record is stored.
     */
    latestObservation(): string | undefined;
    /**
     * Return the newest day a mirrored word was added to the plan.
     *
     * `add_date` is upstream's own "date added", so this says how far the mirror
     * reaches into the plan's growth rather than how recently it was read.
     * @returns the latest `add_date`, or `undefined` when no record is stored.
     */
    latestAddDate(): string | undefined;
    /**
     * Return every word the mirror knows, for local similarity ranking.
     * @returns each stored word's id and spelling.
     */
    allWords(): {
        wordId: string;
        spelling: string;
    }[];
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
    saveQuizMistakes(day: string, mistakes: readonly {
        wordId: string;
        spelling: string;
        prompt?: string | undefined;
        type?: string | undefined;
    }[]): {
        added: number;
        repeated: number;
    };
    /**
     * Mark a mistake as cleared because the word was answered correctly.
     * @param wordId - the word answered correctly.
     * @param day - the Beijing day it was answered correctly.
     * @returns whether a mistake row was cleared.
     */
    clearQuizMistake(wordId: string, day: string): boolean;
    /**
     * List the mistake book, most-missed first.
     * @param options - whether to include cleared words, and the page.
     * @returns one page of mistakes and the matching total.
     */
    listQuizMistakes(options: {
        includeCleared: boolean;
        pageSize: number;
        offset: number;
    }): {
        words: Record<string, unknown>[];
        total: number;
    };
    /** Count the mistake book by state, for the day's report. */
    quizMistakeSummary(): {
        open: number;
        cleared: number;
    };
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
    }): {
        words: Record<string, unknown>[];
        total: number;
    };
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
    recordPlanCoverage(covered: number, knownTotal: number): string;
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
    planCoverage(): Record<string, unknown> | undefined;
    /**
     * Return the freshest study-record read, whatever its scope.
     *
     * `finished_at` has millisecond resolution, so a same-millisecond pair of reads
     * needs `rowid` to break the tie; without it the "latest" read would be
     * whichever the query planner happened to return first.
     */
    latestStudyWindow(): Record<string, unknown> | undefined;
    listPlanning(scope: 'current_planning' | 'removed_history', includeRemoved: boolean, pageSize: number, offset: number): {
        words: Record<string, unknown>[];
        total: number;
    };
    saveStudyWindow(words: StudyRecordFact[], scopeKey: string, knownTotal: number | undefined, sourceLimit?: number): {
        syncId: string;
        completeness: Completeness;
    };
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
    queryRecords(filter: StudyRecordQuery): {
        words: Record<string, unknown>[];
        total: number;
    };
}
