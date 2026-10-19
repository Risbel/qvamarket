import { and, order, orderPayment, sql } from "@qvashop/db";
import type { DateRange } from "@/lib/date-range";

type InstantColumn = typeof order.createdAt | typeof orderPayment.paidAt;

/**
 * Rows whose instant falls on the calendar days `from`..`to` of the range's timezone. The exact
 * test is the instant's LOCAL date (instant -> local time always has one answer); converting a
 * local midnight to an instant does not, because some zones change clocks at midnight (Cuba's
 * Nov 1 starts with 00:00 twice). The wider instant bounds only let an index prune rows.
 */
export function onLocalDays(column: InstantColumn, range: DateRange | null) {
  if (!range) return undefined;
  const { from, to, timeZone } = range;
  return and(
    sql`${column} >= (${from}::date)::timestamp at time zone ${timeZone} - interval '1 day'`,
    sql`${column} < (${to}::date + 1)::timestamp at time zone ${timeZone} + interval '1 day'`,
    sql`(${column} at time zone ${timeZone})::date between ${from}::date and ${to}::date`,
  );
}

/** The instant's calendar day in a timezone, as YYYY-MM-DD text (for group by). */
export function localDay(column: InstantColumn, timeZone: string) {
  return sql<string>`to_char(${column} at time zone ${timeZone}, 'YYYY-MM-DD')`;
}
