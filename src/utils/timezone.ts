// utils/timezone.ts
//
// Timezone-aware date calculations for HisabBoi business analytics.
// Default timezone is Asia/Dhaka (UTC+6, +360 minutes offset).
// Guarantees start-inclusive and end-exclusive UTC boundaries.

export const DEFAULT_TIMEZONE = 'Asia/Dhaka';
export const DHAKA_OFFSET_MINUTES = 360; // +06:00

export interface ResolvedDateRange {
  start: Date;
  endExclusive: Date;
  label: string;
  preset?: string;
  timezone: string;
}

/**
 * Returns the current date shifted to the local timezone.
 */
const getLocalNow = (offsetMinutes: number = DHAKA_OFFSET_MINUTES): Date =>
  // The offset already IS the target timezone, so the host's own offset must
  // not be mixed in — doing so shifts "today" by the host delta and lands on
  // the wrong calendar day for roughly a quarter of all hours.
  new Date(Date.now() + offsetMinutes * 60000);

/**
 * Converts local year, month (0-11), day, hour, min, sec to a UTC Date.
 */
const makeUtcFromLocal = (
  year: number,
  month: number,
  day: number,
  hour: number = 0,
  min: number = 0,
  sec: number = 0,
  offsetMinutes: number = DHAKA_OFFSET_MINUTES,
): Date => {
  // Construct UTC milliseconds treating parameters as UTC, then subtract the local offset
  const ms = Date.UTC(year, month, day, hour, min, sec) - offsetMinutes * 60000;
  return new Date(ms);
};

/**
 * Resolves a date preset or custom from/to into UTC start-inclusive & end-exclusive bounds.
 */
export const resolveDateRange = (
  input?: {
    preset?: string;
    from?: string;
    to?: string;
  },
  offsetMinutes: number = DHAKA_OFFSET_MINUTES,
  timezoneName: string = DEFAULT_TIMEZONE,
): ResolvedDateRange => {
  const localNow = getLocalNow(offsetMinutes);
  const y = localNow.getUTCFullYear();
  const m = localNow.getUTCMonth();
  const d = localNow.getUTCDate();

  const preset = input?.preset?.toLowerCase();

  switch (preset) {
    case 'today': {
      const start = makeUtcFromLocal(y, m, d, 0, 0, 0, offsetMinutes);
      const endExclusive = makeUtcFromLocal(y, m, d + 1, 0, 0, 0, offsetMinutes);
      return { start, endExclusive, label: 'Today', preset: 'today', timezone: timezoneName };
    }

    case 'yesterday': {
      const start = makeUtcFromLocal(y, m, d - 1, 0, 0, 0, offsetMinutes);
      const endExclusive = makeUtcFromLocal(y, m, d, 0, 0, 0, offsetMinutes);
      return { start, endExclusive, label: 'Yesterday', preset: 'yesterday', timezone: timezoneName };
    }

    case 'thisweek': {
      // Local day of week: 0=Sun, 1=Mon, ..., 6=Sat.
      // HisabBoi business week starts on Monday (1).
      const dayOfWeek = localNow.getUTCDay();
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const start = makeUtcFromLocal(y, m, d - diffToMonday, 0, 0, 0, offsetMinutes);
      const endExclusive = makeUtcFromLocal(y, m, d + 1, 0, 0, 0, offsetMinutes);
      return { start, endExclusive, label: 'This Week', preset: 'thisWeek', timezone: timezoneName };
    }

    case 'lastweek': {
      const dayOfWeek = localNow.getUTCDay();
      const diffToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const start = makeUtcFromLocal(y, m, d - diffToMonday - 7, 0, 0, 0, offsetMinutes);
      const endExclusive = makeUtcFromLocal(y, m, d - diffToMonday, 0, 0, 0, offsetMinutes);
      return { start, endExclusive, label: 'Last Week', preset: 'lastWeek', timezone: timezoneName };
    }

    case 'thismonth': {
      const start = makeUtcFromLocal(y, m, 1, 0, 0, 0, offsetMinutes);
      const endExclusive = makeUtcFromLocal(y, m + 1, 1, 0, 0, 0, offsetMinutes);
      return { start, endExclusive, label: 'This Month', preset: 'thisMonth', timezone: timezoneName };
    }

    case 'lastmonth': {
      const start = makeUtcFromLocal(y, m - 1, 1, 0, 0, 0, offsetMinutes);
      const endExclusive = makeUtcFromLocal(y, m, 1, 0, 0, 0, offsetMinutes);
      return { start, endExclusive, label: 'Last Month', preset: 'lastMonth', timezone: timezoneName };
    }

    case 'last7': {
      const start = makeUtcFromLocal(y, m, d - 6, 0, 0, 0, offsetMinutes);
      const endExclusive = makeUtcFromLocal(y, m, d + 1, 0, 0, 0, offsetMinutes);
      return { start, endExclusive, label: 'Last 7 Days', preset: 'last7', timezone: timezoneName };
    }

    case 'last30': {
      const start = makeUtcFromLocal(y, m, d - 29, 0, 0, 0, offsetMinutes);
      const endExclusive = makeUtcFromLocal(y, m, d + 1, 0, 0, 0, offsetMinutes);
      return { start, endExclusive, label: 'Last 30 Days', preset: 'last30', timezone: timezoneName };
    }

    case 'thisyear': {
      const start = makeUtcFromLocal(y, 0, 1, 0, 0, 0, offsetMinutes);
      const endExclusive = makeUtcFromLocal(y + 1, 0, 1, 0, 0, 0, offsetMinutes);
      return { start, endExclusive, label: 'This Year', preset: 'thisYear', timezone: timezoneName };
    }

    default: {
      // Custom date range
      if (input?.from || input?.to) {
        const fromStr = toLocalDayString(input.from) ?? new Date(0).toISOString().slice(0, 10);
        const toStr = toLocalDayString(input.to) ?? localNow.toISOString().slice(0, 10);

        const fromParts = fromStr.split('-').map(Number);
        const toParts = toStr.split('-').map(Number);

        const start = makeUtcFromLocal(
          fromParts[0] || y,
          (fromParts[1] || 1) - 1,
          fromParts[2] || 1,
          0,
          0,
          0,
          offsetMinutes,
        );

        // to date is inclusive in user intent, so endExclusive is next day 00:00
        const endExclusive = makeUtcFromLocal(
          toParts[0] || y,
          (toParts[1] || 1) - 1,
          (toParts[2] || 1) + 1,
          0,
          0,
          0,
          offsetMinutes,
        );

        return {
          start,
          endExclusive,
          label: `${fromStr} to ${toStr}`,
          preset: 'custom',
          timezone: timezoneName,
        };
      }

      // Default fallback: thisMonth
      const start = makeUtcFromLocal(y, m, 1, 0, 0, 0, offsetMinutes);
      const endExclusive = makeUtcFromLocal(y, m + 1, 1, 0, 0, 0, offsetMinutes);
      return { start, endExclusive, label: 'This Month', preset: 'thisMonth', timezone: timezoneName };
    }
  }
};

/**
 * Format a Date to local ISO day "YYYY-MM-DD" string in the given timezone offset.
 */
export const toLocalIsoDay = (date: Date, offsetMinutes: number = DHAKA_OFFSET_MINUTES): string => {
  const localMs = date.getTime() + offsetMinutes * 60000;
  const d = new Date(localMs);
  return d.toISOString().slice(0, 10);
};

/**
 * "YYYY-MM-DD" for a request date. A plain day passes through; a full ISO
 * timestamp (what the app's date pickers often send) becomes the Dhaka
 * calendar day it falls on. Splitting a timestamp on "-" used to yield NaN.
 */
export const toLocalDayString = (value?: string, offsetMinutes: number = DHAKA_OFFSET_MINUTES): string | undefined => {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : toLocalIsoDay(d, offsetMinutes);
};

/** Dhaka calendar-year bounds: [1 Jan 00:00, next 1 Jan 00:00). */
export const localYearRange = (year: number, offsetMinutes: number = DHAKA_OFFSET_MINUTES) => ({
  start: makeUtcFromLocal(year, 0, 1, 0, 0, 0, offsetMinutes),
  endExclusive: makeUtcFromLocal(year + 1, 0, 1, 0, 0, 0, offsetMinutes),
});

/**
 * The Dhaka calendar day of `date` as UTC midnight of that day. Meals are
 * stored keyed this way, so "today" must be the shop's today: at 01:00 in
 * Dhaka the UTC date is still yesterday.
 */
export const localCalendarDay = (date: Date = new Date(), offsetMinutes: number = DHAKA_OFFSET_MINUTES): Date => {
  const local = new Date(date.getTime() + offsetMinutes * 60000);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()));
};

/** The Dhaka calendar year right now. */
export const localYear = (offsetMinutes: number = DHAKA_OFFSET_MINUTES): number =>
  getLocalNow(offsetMinutes).getUTCFullYear();

/** "+06:00" for MongoDB $dateToString / $month so grouping uses Dhaka days. */
export const MONGO_TZ = '+06:00';

/** The Dhaka calendar month right now: { year, month } with month 0-11. */
export const localYearMonth = (offsetMinutes: number = DHAKA_OFFSET_MINUTES) => {
  const now = getLocalNow(offsetMinutes);
  return { year: now.getUTCFullYear(), month: now.getUTCMonth() };
};

/** Dhaka month bounds for real timestamps: [1st 00:00, next 1st 00:00). month is 0-11. */
export const localMonthRange = (year: number, month: number, offsetMinutes: number = DHAKA_OFFSET_MINUTES) => ({
  start: makeUtcFromLocal(year, month, 1, 0, 0, 0, offsetMinutes),
  endExclusive: makeUtcFromLocal(year, month + 1, 1, 0, 0, 0, offsetMinutes),
});

/** Month bounds for calendar-day keys stored as UTC midnight (meals). month is 0-11. */
export const calendarMonthRange = (year: number, month: number) => ({
  start: new Date(Date.UTC(year, month, 1)),
  endExclusive: new Date(Date.UTC(year, month + 1, 1)),
});
