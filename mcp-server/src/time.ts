/**
 * Day arithmetic in 墨墨's own timezone.
 *
 * Every day boundary this mirror cares about is Beijing's: `/study/get_today_items`
 * publishes "today's items", `/study/get_study_progress` counts the day's
 * target, and every `*_study_date` upstream returns is Beijing midnight written
 * as a UTC instant (`2026-09-12T16:00:00.000Z` is Beijing 2026-09-13). Keying
 * local rows by the machine's own clock instead put two conventions in one
 * database and made a raw `substr(value, 1, 10)` name the previous day.
 */

/** 墨墨's timezone, where its study day rolls over. */
export const beijingTimeZone = 'Asia/Shanghai';

const beijingDateParts = new Intl.DateTimeFormat('en-US', {
  timeZone: beijingTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** Render one instant as `YYYY-MM-DD` in 墨墨's timezone. */
const formatBeijingDate = (instant: Date): string => {
  const parts = beijingDateParts.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
};

/**
 * Convert an instant — or an already-Beijing calendar date — to `YYYY-MM-DD` in 墨墨's timezone.
 *
 * A bare `YYYY-MM-DD` parses as UTC midnight, which is the same Beijing calendar
 * day, so the conversion is idempotent: applying it to a value this mirror
 * already normalized changes nothing.
 * @param value - an ISO instant, a bare calendar date, or a `Date`.
 * @returns the Beijing calendar date; `undefined` for `undefined`; the input
 * unchanged when it cannot be parsed, so no upstream value is silently dropped.
 */
export const toBeijingDate = (value: string | Date | undefined): string | undefined => {
  if (value === undefined) return undefined;
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return typeof value === 'string' ? value : undefined;
  return formatBeijingDate(instant);
};

/** Today's calendar date in 墨墨's timezone. */
export const todayInBeijing = (): string => formatBeijingDate(new Date());

/**
 * The Beijing calendar day after one.
 * @param day - a `YYYY-MM-DD` Beijing day.
 * @returns the following day, or the input unchanged when it cannot be parsed.
 */
export const nextBeijingDay = (day: string): string => {
  const instant = Date.parse(`${day}T00:00:00Z`);
  if (Number.isNaN(instant)) return day;
  return new Date(instant + 86_400_000).toISOString().slice(0, 10);
};

/**
 * Whole Beijing days from one instant to another.
 *
 * Both sides are reduced to their Beijing calendar day first, so the result
 * counts how many of 墨墨's days separate them rather than how much time passed:
 * an observation at 23:00 and one at 01:00 the next Beijing day are one day
 * apart, which is what decides whether a day's word list went unread.
 * @param from - the earlier instant or calendar day.
 * @param to - the later instant or calendar day.
 * @returns the day difference, or `undefined` when either side cannot be parsed.
 */
export const beijingDayGap = (from: string | Date, to: string | Date): number | undefined => {
  const fromDay = toBeijingDate(from);
  const toDay = toBeijingDate(to);
  if (fromDay === undefined || toDay === undefined) return undefined;
  const start = Date.parse(`${fromDay}T00:00:00Z`);
  const end = Date.parse(`${toDay}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return Math.round((end - start) / 86_400_000);
};
