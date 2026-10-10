"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { addDays, isIsoDate, startOfMonth, todayIn, type DateRange } from "@/lib/date-range";
import { useHydrated } from "@/lib/use-hydrated";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PRESETS = ["today", "yesterday", "last7", "thisMonth"] as const;

/**
 * Filter by the day orders were placed, in the VIEWER's timezone (the browser's): "today"
 * means today where the merchant is, matching the local times shown in the list. The URL
 * carries the dates and that timezone, so the server can compute the exact instants.
 */
export function DateFilter({ range, keep }: { range: DateRange | null; keep: Record<string, string> }) {
  const t = useTranslations("Orders.dates");
  const router = useRouter();
  const hydrated = useHydrated();
  const timeZone = hydrated ? Intl.DateTimeFormat().resolvedOptions().timeZone : null;
  const [from, setFrom] = useState(range?.from ?? "");
  const [to, setTo] = useState(range?.to ?? "");

  function go(next: { from: string; to: string } | null) {
    const query: Record<string, string> = { ...keep };
    if (next && timeZone) Object.assign(query, { from: next.from, to: next.to, tz: timeZone });
    router.push({ pathname: "/dashboard/orders", query });
  }

  function preset(key: (typeof PRESETS)[number]): { from: string; to: string } | null {
    if (!timeZone) return null;
    const today = todayIn(timeZone);
    if (key === "today") return { from: today, to: today };
    if (key === "yesterday") return { from: addDays(today, -1), to: addDays(today, -1) };
    if (key === "last7") return { from: addDays(today, -6), to: today };
    return { from: startOfMonth(today), to: today };
  }

  const valid = isIsoDate(from) && isIsoDate(to);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-end gap-2">
        {PRESETS.map((key) => {
          const value = preset(key);
          const active = !!value && !!range && range.from === value.from && range.to === value.to && range.timeZone === timeZone;
          return (
            <button
              key={key}
              type="button"
              disabled={!value}
              aria-pressed={active}
              onClick={() => {
                if (!value) return;
                setFrom(value.from);
                setTo(value.to);
                go(value);
              }}
              className={cn(buttonVariants({ variant: active ? "secondary" : "outline", size: "sm" }))}
            >
              {t(`presets.${key}`)}
            </button>
          );
        })}

        <form
          method="get"
          className="flex flex-wrap items-end gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) go(from <= to ? { from, to } : { from: to, to: from });
          }}
        >
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("from")}
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="h-8 w-auto" />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {t("to")}
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="h-8 w-auto" />
          </label>
          <button type="submit" disabled={!hydrated || !valid} className={buttonVariants({ variant: "outline", size: "sm" })}>
            {t("apply")}
          </button>
        </form>

        {range && (
          <button
            type="button"
            onClick={() => {
              setFrom("");
              setTo("");
              go(null);
            }}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            {t("clear")}
          </button>
        )}
      </div>
      {/* A shared link may carry someone else's timezone: say which days these are */}
      {range && timeZone && range.timeZone !== timeZone && (
        <p className="text-xs text-muted-foreground">{t("otherTimeZone", { timeZone: range.timeZone })}</p>
      )}
    </div>
  );
}
