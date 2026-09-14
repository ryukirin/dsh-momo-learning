import { MaimemoClient } from './maimemo-client.js';
import { config } from '../config.js';
import { diagnostic } from '../redaction.js';
import { toBeijingDate } from '../time.js';

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

/** Date fields upstream publishes as instants and the mirror stores as Beijing calendar days. */
const studyDateFields = [
  'add_date',
  'first_study_date',
  'last_study_date',
  'next_study_date'
] as const;

/** Rewrite every published date of one record to 墨墨's calendar day. */
const toBeijingRecord = (record: StudyRecord): StudyRecord => {
  const converted: StudyRecord = { ...record };
  for (const field of studyDateFields) {
    const value = record[field];
    if (value !== undefined) converted[field] = toBeijingDate(value);
  }
  return converted;
};

/** Begin one inclusive Beijing day, in the offset upstream documents. */
const startOfBeijingDay = (day: string): string => `${day}T00:00:00+08:00`;

/** End one inclusive Beijing day, in the offset upstream documents. */
const endOfBeijingDay = (day: string): string => `${day}T23:59:59+08:00`;

/**
 * Send one `query_study_records` read and normalize what comes back.
 *
 * Dates are sent with an explicit `+08:00` offset: a bare `YYYY-MM-DD` carries
 * no timezone, so where its boundary lands would be upstream's decision rather
 * than the Beijing day the caller named.
 */
const queryStudyRecords = async (
  client: MaimemoClient,
  body: Record<string, unknown>
): Promise<{ records: StudyRecord[]; count?: number }> => {
  const response = await client.post<{ records?: StudyRecord[]; count?: number }>(
    '/open/api/v1/memo/study/query_study_records',
    body
  );
  return { records: (response.records ?? []).map(toBeijingRecord), count: response.count };
};

/**
 * Read one range of study records, with upstream's own total for that range.
 * @param client - the upstream client.
 * @param start - inclusive Beijing day, `YYYY-MM-DD`.
 * @param end - inclusive Beijing day, `YYYY-MM-DD`.
 * @param limit - upstream page size, at most 1000.
 * @returns the day-normalized records and the upstream's known total.
 */
export const getStudyRecords = async (
  client: MaimemoClient,
  start: string,
  end: string,
  limit: number
): Promise<{ records: StudyRecord[]; count?: number }> => {
  const body = {
    next_study_date: { start: startOfBeijingDay(start), end: endOfBeijingDay(end) },
    limit
  };
  const page = await queryStudyRecords(client, body);
  const countResponse = await client.post<{ count?: number }>(
    '/open/api/v1/memo/study/query_study_records',
    { ...body, as_count: true }
  );
  const count = countResponse.count ?? page.count;
  diagnostic('学习记录窗口读取完成。', {
    returnedCount: page.records.length,
    knownTotal: count ?? null
  });
  return { records: page.records, count };
};

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
export const getStudyRecordsPage = async (
  client: MaimemoClient,
  options: { start?: string | undefined; limit: number }
): Promise<{ records: StudyRecord[] }> =>
  queryStudyRecords(client, {
    ...(options.start === undefined ? {} : { next_study_date: { start: startOfBeijingDay(options.start) } }),
    limit: options.limit
  });

/**
 * Read upstream's own total for the whole plan.
 *
 * This is the only evidence that can prove a backfill covered everything: a walk
 * that reached the end of its ordering proves nothing on its own, because a
 * page-level read cannot show that no word sits outside the walk.
 * @param client - the upstream client.
 * @returns the plan's word count, or `undefined` when upstream did not report one.
 */
export const countStudyRecords = async (client: MaimemoClient): Promise<number | undefined> => {
  const response = await client.post<{ count?: number }>(
    '/open/api/v1/memo/study/query_study_records',
    { as_count: true }
  );
  return response.count;
};

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
export const getStudyRecordsByWordIds = async (
  client: MaimemoClient,
  wordIds: string[]
): Promise<{ records: StudyRecord[]; calls: number }> => {
  const records: StudyRecord[] = [];
  let calls = 0;
  for (let index = 0; index < wordIds.length; index += config.upstreamCollectionMax) {
    const chunk = wordIds.slice(index, index + config.upstreamCollectionMax);
    const page = await queryStudyRecords(client, { voc_ids: chunk, limit: chunk.length });
    records.push(...page.records);
    calls += 1;
  }
  diagnostic('按词刷新学习记录完成。', {
    requested: wordIds.length,
    returnedCount: records.length,
    calls
  });
  return { records, calls };
};
