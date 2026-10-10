"use client";

import { useHydrated } from "@/lib/use-hydrated";

/**
 * A date and time in the viewer's own timezone. The server does not know it, so the text is
 * filled in after hydration (nothing is rendered on the server, avoiding a mismatch).
 */
export function LocalDateTime({ iso, locale }: { iso: string; locale: string }) {
  const hydrated = useHydrated();
  const text = hydrated
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso))
    : null;
  return <time dateTime={iso}>{text}</time>;
}

/** ISO date -> value for <input type="datetime-local"> in the browser's timezone. */
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** <input type="datetime-local"> value (browser's timezone) -> ISO in UTC; "" stays "". */
export function localInputToIso(value: string): string {
  return value ? new Date(value).toISOString() : "";
}
