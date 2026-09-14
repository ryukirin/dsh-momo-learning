import { MaimemoClient } from './maimemo-client.js';
export interface StudyRecord {
    voc_id: string;
    voc_spelling: string;
    add_date?: string;
    first_study_date?: string;
    last_study_date?: string;
    next_study_date?: string;
    study_count?: number;
    tags?: string[];
}
/**
 * Read one range of study records, with upstream's own total for that range.
 * @param client - the upstream client.
 * @param start - inclusive Beijing day, `YYYY-MM-DD`.
 * @param end - inclusive Beijing day, `YYYY-MM-DD`.
 * @param limit - upstream page size, at most 1000.
 * @returns the day-normalized records and the upstream's known total.
 */
export declare const getStudyRecords: (client: MaimemoClient, start: string, end: string, limit: number) => Promise<{
    records: StudyRecord[];
    count?: number;
}>;
/**
 * Read one page of the whole plan, ordered by next study day.
 *
 * Upstream publishes no cursor, so a full backfill pages by sliding the lower
 * bound to the last day the previous page reached. Rows on the boundary day are
 * returned again by the next page, which is harmless because the mirror keys a
 * record by word; a page that cannot advance the bound is what ends the walk.
 * @param client - the upstream client.
 * @param options - optional lower bound (inclusive Beijing day) and page size.
 * @returns the page's records, ordered by next study day.
 */
export declare const getStudyRecordsPage: (client: MaimemoClient, options: {
    start?: string | undefined;
    limit: number;
}) => Promise<{
    records: StudyRecord[];
}>;
/**
 * Read upstream's own total for the whole plan.
 *
 * This is the only evidence that can prove a backfill covered everything: a walk
 * that reached the end of its ordering proves nothing on its own, because a
 * page-level read cannot show that no word sits outside the walk.
 * @param client - the upstream client.
 * @returns the plan's word count, or `undefined` when upstream did not report one.
 */
export declare const countStudyRecords: (client: MaimemoClient) => Promise<number | undefined>;
/**
 * Read the records of specific words.
 *
 * This is the incremental refresh, and naming the words is what makes it
 * complete: upstream filters dates only by next study day, and studying a word
 * pushes that day into the future, so a window over a period the mirror missed
 * would exclude the very records that changed in it. Upstream ignores other
 * filters when `voc_ids` is present.
 * @param client - the upstream client.
 * @param wordIds - word ids to refresh, chunked at upstream's 1000-item limit.
 * @returns the day-normalized records, and how many upstream calls it took.
 */
export declare const getStudyRecordsByWordIds: (client: MaimemoClient, wordIds: string[]) => Promise<{
    records: StudyRecord[];
    calls: number;
}>;
