"use client";

import { useState } from "react";
import { CalendarIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { DateRange as DayRange } from "react-day-picker";
import { enUS, es } from "react-day-picker/locale";
import { addDays, startOfMonth, todayIn, type DateRange } from "@/lib/date-range";
import { useHydrated } from "@/lib/use-hydrated";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";

const PRESETS = ["today", "yesterday", "last7", "thisMonth"] as const;
const CALENDAR_LOCALES = { es, en: enUS } as const;

const pad = (n: number) => String(n).padStart(2, "0");
/** "2026-10-07" -> that day at local midnight (what the calendar works with) */
const toDay = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const toIso = (day: Date) => `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;

/** "1–7 oct", "28 sept – 3 oct", with the year when it is not this one. Same text on server and browser. */
function formatDays(from: string, to: string, locale: string) {
  const [start, end] = [from, to].map((iso) => new Date(`${iso}T00:00:00Z`));
  const showYear = start.getUTCFullYear() !== end.getUTCFullYear() || end.getUTCFullYear() !== new Date().getUTCFullYear();
  const format = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: showYear ? "numeric" : undefined,
    timeZone: "UTC",
  });
  return from === to ? format.format(start) : format.formatRange(start, end);
}

/**
 * Filter by the day orders were placed, in the VIEWER's timezone (the browser's): "today"
 * means today where the merchant is, matching the local times shown in the list. The URL
 * carries the dates and that timezone, so the server can compute the exact instants.
 */
export function DateFilter({ value, onChange }: { value: DateRange | null; onChange: (range: DateRange | null) => void }) {
  const t = useTranslations("Orders.dates");
  const locale = useLocale();
  const hydrated = useHydrated();
  const timeZone = hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<DayRange | undefined>();

  function preset(key: (typeof PRESETS)[number], zone: string): { from: string; to: string } {
    const today = todayIn(zone);
    if (key === "today") return { from: today, to: today };
    if (key === "yesterday") return { from: addDays(today, -1), to: addDays(today, -1) };
    if (key === "last7") return { from: addDays(today, -6), to: today };
    return { from: startOfMonth(today), to: today };
  }

  const activePreset =
    value && timeZone && value.timeZone === timeZone
      ? PRESETS.find((key) => {
          const days = preset(key, timeZone);
          return days.from === value.from && days.to === value.to;
        })
      : undefined;
  const label = activePreset ? t(`presets.${activePreset}`) : value ? formatDays(value.from, value.to, locale) : null;

  function commit(days: { from: string; to: string } | null) {
    setOpen(false);
    if (!days) onChange(null);
    else if (timeZone) onChange({ ...days, timeZone });
  }

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        // Start from what the list shows now
        if (next) setDraft(value ? { from: toDay(value.from), to: toDay(value.to) } : undefined);
        setOpen(next);
      }}
    >
      {/* Needs the browser's timezone, so it waits for hydration */}
      <PopoverTrigger render={<Button variant="outline" className="border-dashed" disabled={!timeZone} />}>
        <CalendarIcon data-icon="inline-start" />
        {t("label")}
        {label && (
          <>
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Badge variant="secondary" className="rounded-sm px-1 font-normal">
              {label}
            </Badge>
          </>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-auto p-0">
        {timeZone && (
          <div className="flex flex-col sm:flex-row">
            <div className="flex flex-wrap gap-1 border-b p-2 sm:flex-col sm:border-r sm:border-b-0">
              {PRESETS.map((key) => (
                <Button
                  key={key}
                  variant={key === activePreset ? "secondary" : "ghost"}
                  size="sm"
                  className="justify-start"
                  aria-pressed={key === activePreset}
                  onClick={() => commit(preset(key, timeZone))}
                >
                  {t(`presets.${key}`)}
                </Button>
              ))}
            </div>
            <div className="flex flex-col">
              <Calendar
                mode="range"
                selected={draft}
                onSelect={setDraft}
                defaultMonth={draft?.from ?? toDay(todayIn(timeZone))}
                disabled={{ after: toDay(todayIn(timeZone)) }}
                locale={CALENDAR_LOCALES[locale as keyof typeof CALENDAR_LOCALES] ?? enUS}
              />
              {/* A shared link may carry someone else's timezone: say which days these are */}
              {value && value.timeZone !== timeZone && (
                <p className="max-w-64 px-3 pb-2 text-xs text-muted-foreground">
                  {t("otherTimeZone", { timeZone: value.timeZone })}
                </p>
              )}
              <div className="flex justify-end gap-2 border-t p-2">
                {value && (
                  <Button variant="ghost" size="sm" onClick={() => commit(null)}>
                    {t("clear")}
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={!draft?.from}
                  onClick={() => draft?.from && commit({ from: toIso(draft.from), to: toIso(draft.to ?? draft.from) })}
                >
                  {t("apply")}
                </Button>
              </div>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
