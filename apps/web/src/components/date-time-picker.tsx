"use client";

import { useState } from "react";
import { CalendarIcon, XIcon } from "lucide-react";
import { enUS, es } from "react-day-picker/locale";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const CALENDAR_LOCALES = { es, en: enUS } as const;

const pad = (n: number) => String(n).padStart(2, "0");

/** Minutes between the times offered */
const TIME_STEP_MINUTES = 30;

/** "00:00", "00:30" ... "23:30", plus "23:59" (the end of a day) */
const TIMES = [
  ...Array.from({ length: (24 * 60) / TIME_STEP_MINUTES }, (_, i) => {
    const minutes = i * TIME_STEP_MINUTES;
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
  }),
  "23:59",
];

/** "14:30" -> "14:30" (es) or "2:30 PM" (en) */
function formatTime(time: string, locale: string) {
  const [hours, minutes] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, hours, minutes));
}

/**
 * A day (shadcn Calendar in a popover) plus a time, in the browser's timezone. The value has
 * the format of <input type="datetime-local"> ("2026-10-15T09:30", "" = none), so it works with
 * isoToLocalInput / localInputToIso. Only render it with a value set after hydration: the
 * server does not know the viewer's timezone.
 */
export function DateTimePicker({
  id,
  value,
  onChange,
  defaultTime,
  maxDate,
  locale,
  invalid,
  labels,
}: {
  /** id of the day button, for the field's <label htmlFor> */
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** time used when a day is picked and none was set yet, e.g. "00:00" or "23:59" */
  defaultTime: string;
  /** last day that can be picked (later days are disabled), e.g. today for something that already happened */
  maxDate?: Date;
  locale: string;
  invalid?: boolean;
  labels: { placeholder: string; time: string; clear: string };
}) {
  const [open, setOpen] = useState(false);
  const [datePart = "", timePart = ""] = value.split("T");
  const [year, month, day] = datePart.split("-").map(Number);
  const selected = datePart ? new Date(year, month - 1, day) : undefined;
  // A saved time off the list (e.g. 09:15) is still offered, in order
  const times = timePart && !TIMES.includes(timePart) ? [...TIMES, timePart].sort() : TIMES;

  return (
    <div className="flex gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              id={id}
              variant="outline"
              aria-invalid={invalid || undefined}
              className={cn("min-w-0 flex-1 justify-start font-normal", !selected && "text-muted-foreground")}
            />
          }
        >
          <CalendarIcon />
          <span className="truncate">
            {selected ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(selected) : labels.placeholder}
          </span>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            selected={selected}
            defaultMonth={selected}
            disabled={maxDate ? { after: maxDate } : undefined}
            endMonth={maxDate}
            locale={CALENDAR_LOCALES[locale as keyof typeof CALENDAR_LOCALES] ?? enUS}
            onSelect={(date) => {
              if (!date) return;
              onChange(`${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${timePart || defaultTime}`);
              setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <Select
        value={timePart || null}
        onValueChange={(time) => typeof time === "string" && onChange(`${datePart}T${time}`)}
        disabled={!datePart}
      >
        <SelectTrigger aria-label={labels.time} aria-invalid={invalid || undefined} className="w-28 shrink-0">
          <SelectValue placeholder="--:--">{(time: string | null) => (time ? formatTime(time, locale) : "--:--")}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {times.map((time) => (
            <SelectItem key={time} value={time}>
              {formatTime(time, locale)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value && (
        <Button type="button" variant="ghost" size="icon" aria-label={labels.clear} onClick={() => onChange("")}>
          <XIcon />
        </Button>
      )}
    </div>
  );
}
