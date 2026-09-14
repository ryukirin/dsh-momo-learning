import { diagnostic } from '../redaction.js';
export const getTodayItems = async (client) => {
    const response = await client.post('/open/api/v1/memo/study/get_today_items', {
        limit: 1000
    });
    const items = response.today_items ?? [];
    diagnostic('当天项目读取完成。', { returnedCount: items.length });
    return items;
};
/**
 * Read upstream's progress counters for today.
 *
 * This is the only read that separates "still has words to study" from "nothing
 * is scheduled at all": the today list keeps finished items, so an empty list and
 * a completed day look alike there, while `total` tells them apart.
 * @param client - the upstream client.
 * @returns the day's counters, or an empty object when upstream reports none.
 */
export const getStudyProgress = async (client) => {
    const response = await client.post('/open/api/v1/memo/study/get_study_progress', {});
    diagnostic('今日学习进度读取完成。', {
        finished: response.progress?.finished ?? null,
        total: response.progress?.total ?? null
    });
    return response.progress ?? {};
};
//# sourceMappingURL=today-items.js.map