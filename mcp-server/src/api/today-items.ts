import { MaimemoClient } from './maimemo-client.js';
import { diagnostic } from '../redaction.js';

/** The answer 墨墨 recorded the first time a word came up today. */
export type StudyResponse =
  | 'FAMILIAR'
  | 'VAGUE'
  | 'FORGET'
  | 'WELL_FAMILIAR'
  | 'CANCEL_WELL_FAMILIAR';

export interface TodayItem {
  voc_id: string;
  voc_spelling: string;
  order: number;
  /** How the word was answered today; the app's own verdict on whether it is known. */
  first_response?: StudyResponse;
  is_new?: boolean;
  is_finished?: boolean;
}

export const getTodayItems = async (client: MaimemoClient): Promise<TodayItem[]> => {
  const response = await client.post<{ today_items?: TodayItem[] }>(
    '/open/api/v1/memo/study/get_today_items',
    {
      limit: 1000
    }
  );
  const items = response.today_items ?? [];
  diagnostic('当天项目读取完成。', { returnedCount: items.length });
  return items;
};

/** Upstream's own counters for the current day. */
export interface StudyProgress {
  /** Words completed today. */
  finished?: number;
  /** The day's target word count; zero means nothing is scheduled. */
  total?: number;
  /** Study time in milliseconds. */
  study_time?: number;
}

/**
 * Read upstream's progress counters for today.
 *
 * This is the only read that separates "still has words to study" from "nothing
 * is scheduled at all": the today list keeps finished items, so an empty list and
 * a completed day look alike there, while `total` tells them apart.
 * @param client - the upstream client.
 * @returns the day's counters, or an empty object when upstream reports none.
 */
export const getStudyProgress = async (client: MaimemoClient): Promise<StudyProgress> => {
  const response = await client.post<{ progress?: StudyProgress }>(
    '/open/api/v1/memo/study/get_study_progress',
    {}
  );
  diagnostic('今日学习进度读取完成。', {
    finished: response.progress?.finished ?? null,
    total: response.progress?.total ?? null
  });
  return response.progress ?? {};
};
