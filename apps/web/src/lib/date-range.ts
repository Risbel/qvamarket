// Calendar-day ranges for filters (orders today; a calendar view later).
//
// Instants are stored as UTC (`timestamptz`) and shown in each viewer's own timezone. A "day"
// therefore depends on whose day it is: filters carry local dates PLUS the viewer's IANA
// timezone (`?from=2026-10-01&to=2026-10-07&tz=America/Havana`) and PostgreSQL turns them
// into instants (`(date)::timestamp AT TIME ZONE tz`), which also handles daylight saving.

export type DateRange = {
  /** first day, YYYY-MM-DD, inclusive */
  from: string;
  /** last day, YYYY-MM-DD, inclusive */
  to: string;
  /** IANA name, e.g. "America/Havana" */
  timeZone: string;
};

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date written as YYYY-MM-DD (rejects 2026-02-30 and the like). */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return y >= 2000 && y <= 2999 && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** The canonical IANA name of a timezone the runtime knows, or null. */
export function canonicalTimeZone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64 || !/^[A-Za-z0-9_+\-/]+$/.test(value)) return null;
  try {
    return new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/**
 * Range from URL values; null when any part is missing or invalid (the filter is then off).
 * A reversed range is put in order.
 */
export function parseDateRange(from: unknown, to: unknown, timeZone: unknown): DateRange | null {
  const zone = canonicalTimeZone(timeZone);
  if (!zone || !isIsoDate(from) || !isIsoDate(to)) return null;
  return from <= to ? { from, to, timeZone: zone } : { from: to, to: from, timeZone: zone };
}

/** Today's date (YYYY-MM-DD) in a timezone. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** YYYY-MM-DD plus `days` (negative to go back); plain calendar arithmetic, no timezone. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** First day of the month of a YYYY-MM-DD date. */
export function startOfMonth(date: string): string {
  return `${date.slice(0, 8)}01`;
}
