import { z } from 'zod';
import { MaimemoClient } from '../api/maimemo-client.js';
import { getTodayItems, getStudyProgress } from '../api/today-items.js';
import { countStudyRecords, getStudyRecords, getStudyRecordsByWordIds, getStudyRecordsPage } from '../api/study-records.js';
import { assertPageSize, assertWordIds, config } from '../config.js';
import { MaimemoError, toMaimemoError } from '../errors.js';
import { clearLocalLearningData } from '../db/local-data-clearer.js';
import { BACKFILL_SCOPE_KEY, MirrorRepository } from '../db/mirror-repository.js';
import { TodoRepository } from '../db/todo-repository.js';
import { todayInBeijing, beijingDayGap, nextBeijingDay } from '../time.js';
import { rankSimilarWords } from '../similar.js';
import { envelope } from './tool-envelope.js';
const result = (value) => ({
    content: [{ type: 'text', text: JSON.stringify(value) }]
});
const fail = (error) => {
    const value = toMaimemoError(error);
    return result({
        error: { code: value.code, message: value.message, retryAfterSeconds: value.retryAfterSeconds }
    });
};
const strictObject = (shape) => z.object(shape).strict();
/**
 * Walk the whole plan and store every record it returns.
 *
 * Upstream publishes no cursor, so the walk slides the lower bound to the last
 * next-study day the previous page reached. This is the only read that can
 * discover words added since the mirror last looked, and the only one whose
 * completeness can be proven — against upstream's own `as_count` total.
 * @param mirror - the local mirror.
 * @param db - the open database, for the stored row counts.
 * @param client - the upstream client.
 * @param options - page size and the page cap that bounds the walk.
 * @returns what the walk covered and the evidence it stopped on.
 */
const walkStudyRecords = async (mirror, db, client, options) => {
    const observedAt = new Date().toISOString();
    const wordsBefore = db.prepare('SELECT COUNT(*) AS count FROM study_record').get().count;
    const knownTotal = await countStudyRecords(client);
    const covered = new Set();
    let start;
    let pages = 0;
    let recordsRead = 0;
    let stopped = 'end-of-plan';
    for (;;) {
        const page = await getStudyRecordsPage(client, { start, limit: options.pageSize });
        pages += 1;
        recordsRead += page.records.length;
        for (const record of page.records)
            covered.add(record.voc_id);
        mirror.saveStudyWindow(page.records.map((record) => ({
            wordId: record.voc_id,
            spelling: record.voc_spelling,
            addDate: record.add_date,
            firstStudyDate: record.first_study_date,
            lastStudyDate: record.last_study_date,
            nextStudyDate: record.next_study_date,
            studyCount: record.study_count,
            tags: record.tags
        })), 
        // Each page is a slice, never the whole scope, so the save is recorded as
        // partial completeness and can never mark a word as no longer planned.
        BACKFILL_SCOPE_KEY, undefined, Math.max(page.records.length, 1));
        if (page.records.length < options.pageSize)
            break;
        const lastDay = page.records[page.records.length - 1]?.next_study_date;
        // The sliding bound only advances when a page ends on a day later than the
        // one it started from; a whole page sharing one day cannot advance it, so the
        // walk stops and reports what it actually covered.
        if (lastDay === undefined || lastDay === start) {
            stopped = 'bound-not-advancing';
            break;
        }
        if (pages >= options.maxPages) {
            stopped = 'max-pages';
            break;
        }
        start = lastDay;
    }
    const complete = stopped === 'end-of-plan' && covered.size === knownTotal;
    // Only upstream's own total matching what the walk covered proves the mirror
    // now holds the whole plan; that proof is what a local query cites later.
    if (complete)
        mirror.recordPlanCoverage(covered.size, knownTotal);
    return {
        pages,
        recordsRead,
        wordsCovered: covered.size,
        wordsStored: db.prepare('SELECT COUNT(*) AS count FROM study_record').get().count,
        wordsBefore,
        knownTotal: knownTotal ?? null,
        stoppedBecause: stopped,
        observedAt,
        complete
    };
};
/**
 * Bring the mirrored study records up to date, choosing the cheapest complete method.
 *
 * The stored `observed_at` decides between two cases. When records were already
 * observed today, today's snapshot list is authoritative for today, so only those
 * words can have moved and they are refreshed by name. When whole days are
 * missing, no narrower read can be complete: upstream filters records only by next
 * study day, and studying a word pushes that day into the future — measured on one
 * real plan, every one of the 272 words studied across a three-day gap had moved
 * outside a window covering it, and newly learned words were re-scheduled up to 89
 * days out on the day they were learned. A missed day's word list cannot be fetched
 * after the fact either. The plan is walked whole instead, which also discovers
 * words added during the gap.
 * @param mirror - the local mirror.
 * @param db - the open database, for the stored row counts.
 * @param client - the upstream client.
 * @param day - today in 墨墨's timezone.
 * @param todayWordIds - the word ids of today's saved snapshot.
 * @returns what the refresh did and the evidence behind the choice.
 */
const refreshStudyRecords = async (mirror, db, client, day, todayWordIds) => {
    const lastObservedAt = mirror.latestObservation();
    const gapDays = lastObservedAt === undefined ? null : beijingDayGap(lastObservedAt, day) ?? null;
    const mode = gapDays !== null && gapDays <= 0 ? 'day' : 'catch-up';
    if (mode === 'catch-up') {
        const walk = await walkStudyRecords(mirror, db, client, {
            pageSize: config.upstreamCollectionMax,
            maxPages: 20
        });
        return {
            lastObservedAt: lastObservedAt ?? null,
            gapDays,
            mode,
            words: walk.recordsRead,
            calls: walk.pages + 1,
            walk
        };
    }
    const { records, calls } = await getStudyRecordsByWordIds(client, todayWordIds);
    mirror.saveStudyWindow(records.map((record) => ({
        wordId: record.voc_id,
        spelling: record.voc_spelling,
        addDate: record.add_date,
        firstStudyDate: record.first_study_date,
        lastStudyDate: record.last_study_date,
        nextStudyDate: record.next_study_date,
        studyCount: record.study_count,
        tags: record.tags
    })), `words:${day}`, 
    // A by-name refresh is a slice, never a whole scope: recording it as unknown
    // completeness keeps it from ever marking a word as no longer planned.
    undefined, Math.max(records.length, 1));
    return { lastObservedAt: lastObservedAt ?? null, gapDays, mode, words: records.length, calls };
};
export const registerTools = (server, db, secrets) => {
    const mirror = new MirrorRepository(db);
    const todos = new TodoRepository(db);
    const client = new MaimemoClient(secrets);
    server.registerTool('maimemo_auth_status', { description: '只读本机安全凭证状态。', inputSchema: strictObject({}) }, async () => {
        try {
            const configured = Boolean(secrets.get());
            return result(envelope({ configured, usable: configured, credentialStoreAvailable: secrets.available() }, 'local_mirror'));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_get_learning_overview', {
        description: '只读本地学习镜像概况，不隐式联网。',
        inputSchema: strictObject({ date: z.string().optional() })
    }, async () => {
        try {
            const latest = mirror.latestToday();
            return result(envelope({
                date: latest?.requested_local_date ?? null,
                upstreamDateSemantics: latest?.upstream_date_semantics ?? '未知',
                localTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                lastSyncedAt: latest?.finished_at ?? null
            }, 'local_mirror', latest?.completeness ?? 'unknown', latest ? [] : ['尚无本地学习镜像，请在开始当日待办前同步。'], latest));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_sync_today_snapshot', {
        description: '只读墨墨账号并写入本地当天快照。',
        inputSchema: strictObject({
            requestedLocalDate: z.string().optional(),
            reason: z.enum(['start_daily_todo', 'user_requested'])
        })
    }, async ({ requestedLocalDate }) => {
        try {
            const localDate = requestedLocalDate ?? new Date().toLocaleDateString('sv-SE');
            const words = (await getTodayItems(client))
                .sort((a, b) => a.order - b.order)
                .map((item) => ({
                wordId: item.voc_id,
                spelling: item.voc_spelling,
                order: item.order,
                isNew: item.is_new,
                isFinished: item.is_finished,
                firstResponse: item.first_response
            }));
            // The day key is 墨墨's own day, not the caller's: the upstream list is
            // "today's items" by Beijing midnight, so near that boundary the two
            // dates differ and only the upstream one names the list that came back.
            const day = todayInBeijing();
            const saved = mirror.saveToday(words, day, localDate);
            // Bring the mirrored records up to date, with the method the stored
            // observation time selects. A failure here leaves the snapshot — the
            // primary artifact — intact and reports why.
            const warnings = [];
            if (words.length > config.previewMax)
                warnings.push('完整词表请使用本地分页工具读取。');
            let refresh = null;
            try {
                refresh = await refreshStudyRecords(mirror, db, client, day, words.map((word) => word.wordId));
            }
            catch {
                warnings.push('当天词表已保存，但学习记录的刷新失败；本地记录可能落后。');
            }
            return result(envelope({
                snapshotId: saved.syncId,
                count: words.length,
                // The app's own verdict per word, which is what decides the day's
                // practice scope: re-asking a word the app already confirmed as known
                // repeats work that has already been done.
                responseCounts: mirror.todayResponseCounts(saved.syncId),
                newCount: words.filter((word) => word.isNew === true).length,
                preview: words.slice(0, config.previewMax),
                day,
                recordRefresh: refresh
            }, 'upstream', saved.completeness, warnings));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_list_local_words', {
        description: '只读本地镜像单词，支持本地分页。当天快照范围可按墨墨记录的作答结果与是否新学筛选，用于确定当天要考的词的集合。',
        inputSchema: strictObject({
            scope: z.enum(['today_snapshot', 'current_planning', 'removed_history']),
            pageSize: z.number().int().min(1).max(50).default(20),
            cursor: z.string().optional(),
            snapshotId: z.string().optional(),
            includeRemoved: z.boolean().default(false),
            responses: z
                .array(z.enum(['FAMILIAR', 'VAGUE', 'FORGET', 'WELL_FAMILIAR', 'CANCEL_WELL_FAMILIAR']))
                .optional(),
            isNew: z.boolean().optional()
        })
    }, async ({ scope, pageSize, cursor, snapshotId, includeRemoved, responses, isNew }) => {
        try {
            assertPageSize(pageSize);
            const offset = cursor ? Number(cursor) : 0;
            if (!Number.isSafeInteger(offset) || offset < 0)
                throw new MaimemoError('INVALID_ARGUMENT', '分页游标无效。');
            if (scope === 'today_snapshot') {
                const current = snapshotId ? { id: snapshotId } : mirror.latestToday();
                if (!current?.id)
                    return result(envelope({ words: [], nextCursor: undefined }, 'local_mirror', 'unknown', [
                        '尚无当天快照。'
                    ]));
                const listing = mirror.listTodayPage(String(current.id), {
                    responses,
                    isNew,
                    pageSize,
                    offset
                });
                return result(envelope({
                    words: listing.words,
                    total: listing.total,
                    responseCounts: mirror.todayResponseCounts(String(current.id)),
                    nextCursor: listing.words.length === pageSize ? String(offset + pageSize) : undefined
                }, 'local_mirror'));
            }
            const listing = mirror.listPlanning(scope, includeRemoved, pageSize, offset);
            const latest = mirror.latestStudyWindow();
            return result(envelope({
                words: listing.words,
                total: listing.total,
                nextCursor: listing.words.length === pageSize ? String(offset + pageSize) : undefined,
                readRange: latest?.read_range ?? null
            }, 'local_mirror', latest?.completeness ?? 'unknown', latest ? [] : ['尚无学习记录窗口镜像。'], latest));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_open_daily_todo', {
        description: '仅创建或恢复本地当日待办，不访问墨墨账号。',
        inputSchema: strictObject({ sourceSnapshotId: z.string(), localSessionDate: z.string() })
    }, async ({ sourceSnapshotId, localSessionDate }) => {
        try {
            return result(envelope(todos.open(sourceSnapshotId, localSessionDate), 'local_mirror'));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_get_daily_todo', { description: '只读本地当日待办。', inputSchema: strictObject({ todoId: z.string() }) }, async ({ todoId }) => {
        try {
            return result(envelope(todos.get(todoId), 'local_mirror'));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_update_daily_todo', {
        description: '仅更新本地待办状态，不修改墨墨账号。',
        inputSchema: strictObject({
            todoId: z.string(),
            action: z.enum(['mark_understood', 'skip', 'pause_current', 'resume']),
            expectedCurrentItemId: z.string().optional()
        })
    }, async ({ todoId, action, expectedCurrentItemId }) => {
        try {
            return result(envelope(todos.update(todoId, action, expectedCurrentItemId), 'local_mirror'));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_sync_study_record_window', {
        description: '只读墨墨学习记录窗口并写入本地镜像。',
        inputSchema: strictObject({
            start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '请使用北京时间 YYYY-MM-DD 日期。'),
            end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '请使用北京时间 YYYY-MM-DD 日期。'),
            limit: z.number().int().min(1).max(1000).default(1000),
            reason: z.enum(['user_requested', 'quiz_preparation'])
        })
    }, async ({ start, end, limit }) => {
        try {
            const response = await getStudyRecords(client, start, end, limit);
            const saved = mirror.saveStudyWindow(response.records.map((record) => ({
                wordId: record.voc_id,
                spelling: record.voc_spelling,
                addDate: record.add_date,
                firstStudyDate: record.first_study_date,
                lastStudyDate: record.last_study_date,
                nextStudyDate: record.next_study_date,
                studyCount: record.study_count,
                tags: record.tags
            })), `beijing:${start}:${end}`, response.count, limit);
            return result(envelope({
                snapshotId: saved.syncId,
                count: response.records.length,
                knownTotal: response.count
            }, 'upstream', saved.completeness));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_sync_word_supplements', {
        description: '同步用户自建词汇补充；未经探针确认时返回不支持。',
        inputSchema: strictObject({
            wordIds: z.array(z.string()).min(1).max(50),
            reason: z.enum(['daily_todo', 'user_requested'])
        })
    }, async ({ wordIds }) => {
        try {
            assertWordIds(wordIds);
            throw new MaimemoError('UNSUPPORTED_CAPABILITY', '用户自建内容端点尚未通过本机探针确认。');
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_get_word_supplements', {
        description: '只读已缓存的用户自建词汇补充。',
        inputSchema: strictObject({ wordIds: z.array(z.string()).min(1).max(50) })
    }, async ({ wordIds }) => {
        try {
            assertWordIds(wordIds);
            const rows = db
                .prepare(`SELECT word_id AS wordId,kind,content,translation,source,updated_at AS updatedAt FROM word_supplement WHERE word_id IN (${wordIds.map(() => '?').join(',')})`)
                .all(...wordIds);
            return result(envelope({ supplements: rows }, 'local_mirror'));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_list_quiz_candidates', {
        description: '从整个镜像里挑当天要考的词，按不熟程度排序：本地错题 > 墨墨标记顽固 > 今天复习没记住 > 学得少；已排除今天刚新学的词。只读本地。',
        inputSchema: strictObject({
            limit: z.number().int().min(1).max(50).default(20),
            minDaysSinceStudy: z.number().int().min(0).max(60).default(1)
        })
    }, async ({ limit, minDaysSinceStudy }) => {
        try {
            const day = todayInBeijing();
            const listing = mirror.listQuizCandidates({ limit, minDaysSinceStudy, day });
            const coverage = mirror.planCoverage();
            const warnings = [];
            if (coverage === undefined)
                warnings.push('尚无证明覆盖整个计划的回填，候选只来自本地已验证范围。');
            if (listing.words.length === 0)
                warnings.push('没有符合条件的候选词；可放宽 minDaysSinceStudy 或先做全量回填。');
            return result(envelope({ day, words: listing.words, total: listing.total, minDaysSinceStudy }, 'local_mirror', coverage === undefined ? 'unknown' : 'complete', warnings, coverage));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_record_quiz_mistakes', {
        description: '记录本地出题中答错的词，供明天错题优先与日报使用；只写错题，不留答题流水；该词后来答对时可一并标记消除。',
        inputSchema: strictObject({
            day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '请使用北京时间 YYYY-MM-DD 日期。').optional(),
            mistakes: z
                .array(strictObject({
                wordId: z.string(),
                spelling: z.string(),
                prompt: z.string().optional(),
                type: z.string().optional()
            }))
                .default([]),
            cleared: z.array(z.string()).default([])
        })
    }, async ({ day, mistakes, cleared }) => {
        try {
            const quizDay = day ?? todayInBeijing();
            const saved = mirror.saveQuizMistakes(quizDay, mistakes);
            const clearedCount = cleared.filter((wordId) => mirror.clearQuizMistake(wordId, quizDay)).length;
            return result(envelope({
                day: quizDay,
                added: saved.added,
                repeated: saved.repeated,
                cleared: clearedCount,
                // The whole book, so the report needs no second call.
                book: mirror.quizMistakeSummary()
            }, 'local_mirror'));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_list_quiz_mistakes', {
        description: '只读本地错题本，错得最多的排在前面；用于生成日报与安排明天的题。',
        inputSchema: strictObject({
            includeCleared: z.boolean().default(false),
            pageSize: z.number().int().min(1).max(50).default(20),
            cursor: z.string().optional()
        })
    }, async ({ includeCleared, pageSize, cursor }) => {
        try {
            assertPageSize(pageSize);
            const offset = cursor ? Number(cursor) : 0;
            if (!Number.isSafeInteger(offset) || offset < 0)
                throw new MaimemoError('INVALID_ARGUMENT', '分页游标无效。');
            const listing = mirror.listQuizMistakes({ includeCleared, pageSize, offset });
            return result(envelope({
                words: listing.words,
                total: listing.total,
                summary: mirror.quizMistakeSummary(),
                nextCursor: listing.words.length === pageSize ? String(offset + pageSize) : undefined
            }, 'local_mirror'));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_find_similar_words', {
        description: '在本地计划的词里找与给定单词易混的形近词，用于给新学的词出辨识易错题；只读本地，不访问上游。',
        inputSchema: strictObject({
            spelling: z.string().optional(),
            wordId: z.string().optional(),
            limit: z.number().int().min(1).max(50).default(10)
        })
    }, async ({ spelling, wordId, limit }) => {
        try {
            const target = spelling ??
                (wordId === undefined
                    ? undefined
                    : db.prepare('SELECT spelling FROM mirror_word WHERE word_id=?').get(wordId)?.spelling);
            if (target === undefined)
                throw new MaimemoError('INVALID_ARGUMENT', '请提供 spelling 或已存在于镜像中的 wordId。');
            const candidates = rankSimilarWords(target, mirror.allWords(), limit);
            return result(envelope({ target, candidates }, 'local_mirror', 'unknown', candidates.length === 0
                ? ['本地计划的词里没有足够相近的词，可改用同义或同词根角度出题。']
                : []));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_get_day_state', {
        description: '判断此刻该做什么：今天是否还有待学词、是否该先去 App 学完、以及本地镜像是否已跟上今天新增进规划的词。今天没有待学词时会顺带把计划读到最新。',
        inputSchema: strictObject({})
    }, async () => {
        try {
            const day = todayInBeijing();
            const lastAddDate = mirror.latestAddDate() ?? null;
            const addDateCurrent = lastAddDate === day;
            const progress = await getStudyProgress(client);
            const finished = progress.finished ?? null;
            const total = progress.total ?? null;
            // `total` is the only signal that separates an unfinished day from a day
            // with nothing scheduled: the today list keeps finished items, so it looks
            // the same in both cases.
            let decision;
            if (total === null)
                decision = 'unknown';
            else if (total === 0)
                decision = 'nothing-due';
            else if (finished !== null && finished < total)
                decision = 'finish-in-app';
            else
                decision = 'ready';
            const warnings = [];
            let walk = null;
            let newlyAdded = null;
            // Nothing is scheduled today, so there is nothing to study in the app —
            // and upstream cannot filter records by add date. Reading the plan and
            // keeping the words added since the newest one already mirrored is the
            // only way the mirror follows the plan's growth across such a day.
            if (decision === 'nothing-due' && !addDateCurrent) {
                walk = await walkStudyRecords(mirror, db, client, {
                    pageSize: config.upstreamCollectionMax,
                    maxPages: 20
                });
                const added = mirror.queryRecords({
                    dateField: 'add_date',
                    ...(lastAddDate === null ? {} : { start: nextBeijingDay(lastAddDate) }),
                    end: day,
                    includeRemoved: false,
                    pageSize: config.previewMax,
                    offset: 0
                });
                newlyAdded = { total: added.total, words: added.words };
                if (!walk.complete)
                    warnings.push('计划未走完，本地镜像只覆盖已验证范围；可再次运行补齐。');
            }
            else if (!addDateCurrent) {
                warnings.push(`本地镜像中最新的加入规划日期是 ${lastAddDate ?? '（无）'}，今天新增的词尚未纳入；今天学完后同步即可跟上。`);
            }
            return result(envelope({
                day,
                decision,
                progress: { finished, total, studyTimeMs: progress.study_time ?? null },
                lastAddDate,
                addDateCurrent,
                newlyAdded,
                walk
            }, 'upstream', 'unknown', warnings));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_refresh_study_records', {
        description: '按本地最新观测时间把学习记录刷新到最新；中断多天后会整体补齐而不是只补当天。',
        inputSchema: strictObject({})
    }, async () => {
        try {
            const day = todayInBeijing();
            const outcome = await refreshStudyRecords(mirror, db, client, day, []);
            return result(envelope({ day, ...outcome }, 'upstream', 'partial', outcome.mode === 'catch-up'
                ? ['距上次记录观测已有整日空档，已整体重走一遍计划；上游既无法按历史日期取当日词表，也无法用日期窗口覆盖空档期学过的词，重走是唯一能证明完整的方式。']
                : []));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_query_local_records', {
        description: '只读本地学习记录镜像，按北京日期范围、标签和学习次数筛选，用于出题范围而不访问上游。',
        inputSchema: strictObject({
            dateField: z
                .enum(['last_study_date', 'first_study_date', 'next_study_date', 'add_date'])
                .default('last_study_date'),
            start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '请使用北京时间 YYYY-MM-DD 日期。').optional(),
            end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '请使用北京时间 YYYY-MM-DD 日期。').optional(),
            tags: z.array(z.enum(['STICKING', 'WELL_FAMILIAR'])).optional(),
            minStudyCount: z.number().int().min(0).optional(),
            maxStudyCount: z.number().int().min(0).optional(),
            includeRemoved: z.boolean().default(false),
            pageSize: z.number().int().min(1).max(50).default(20),
            cursor: z.string().optional()
        })
    }, async ({ dateField, start, end, tags, minStudyCount, maxStudyCount, includeRemoved, pageSize, cursor }) => {
        try {
            assertPageSize(pageSize);
            const offset = cursor ? Number(cursor) : 0;
            if (!Number.isSafeInteger(offset) || offset < 0)
                throw new MaimemoError('INVALID_ARGUMENT', '分页游标无效。');
            if (start !== undefined && end !== undefined && start > end)
                throw new MaimemoError('INVALID_ARGUMENT', '起始日期不能晚于结束日期。');
            const listing = mirror.queryRecords({
                dateField,
                start,
                end,
                tags,
                minStudyCount,
                maxStudyCount,
                includeRemoved,
                pageSize,
                offset
            });
            const latest = mirror.latestStudyWindow();
            // Coverage is proven by the plan-wide backfill, not by the freshest read:
            // the daily incremental refresh is a slice and can never claim to cover
            // the plan, so citing it here would mislabel a fully backfilled mirror.
            const coverage = mirror.planCoverage();
            const warnings = [];
            if (coverage === undefined)
                warnings.push('尚无证明覆盖整个计划的回填，本地镜像只覆盖已验证范围。');
            return result(envelope({
                words: listing.words,
                total: listing.total,
                nextCursor: listing.words.length === pageSize ? String(offset + pageSize) : undefined,
                readRange: latest?.read_range ?? null
            }, 'local_mirror', coverage === undefined
                ? (latest?.completeness ?? 'unknown')
                : 'complete', warnings, coverage ?? latest));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_backfill_study_records', {
        description: '一次性把整个学习记录回填到本地镜像；上游无游标，按下次学习日期滑窗分页。',
        inputSchema: strictObject({
            pageSize: z.number().int().min(1).max(1000).default(1000),
            maxPages: z.number().int().min(1).max(100).default(20)
        })
    }, async ({ pageSize, maxPages }) => {
        try {
            const walk = await walkStudyRecords(mirror, db, client, { pageSize, maxPages });
            const { complete, ...data } = walk;
            return result(envelope(data, 'upstream', 
            // Only upstream's own total matching what the walk covered proves the
            // mirror now holds the whole plan; anything less is a verified range.
            complete ? 'complete' : 'partial', complete
                ? []
                : ['回填未证明覆盖整个计划，本地镜像只覆盖已验证范围；可再次运行继续。']));
        }
        catch (error) {
            return fail(error);
        }
    });
    server.registerTool('maimemo_clear_local_learning_data', {
        description: '仅清除本地学习数据，不修改墨墨账号或安全凭证。',
        inputSchema: strictObject({
            scope: z.literal('all_local_learning_data'),
            confirm: z.boolean()
        })
    }, async ({ confirm }) => {
        try {
            if (!confirm)
                throw new MaimemoError('CONFIRMATION_REQUIRED', '请显式传入 confirm:true 以清除本地学习数据。');
            return result(envelope(clearLocalLearningData(db), 'local_mirror'));
        }
        catch (error) {
            return fail(error);
        }
    });
};
//# sourceMappingURL=register-tools.js.map