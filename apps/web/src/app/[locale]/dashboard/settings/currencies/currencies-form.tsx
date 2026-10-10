"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { setStoreCurrenciesAction } from "@/server/catalog-actions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const selectClass = cn(
  "h-8 min-w-0 flex-1 rounded-lg border border-input bg-transparent px-2.5 text-base outline-none md:text-sm",
  "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30",
);

/**
 * Currencies the store sells in. Each product needs its own price in a currency to be sold in
 * it (no automatic conversion). A currency that still has prices cannot be removed.
 */
export function CurrenciesForm({
  enabled,
  defaultCode,
  available,
}: {
  enabled: string[];
  defaultCode: string;
  available: { code: string; label: string }[];
}) {
  const t = useTranslations("Settings.currencies");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [codes, setCodes] = useState(enabled);
  const [current, setCurrent] = useState(defaultCode);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const labelOf = new Map(available.map((c) => [c.code, c.label]));
  const dirty = codes.join() !== enabled.join() || current !== defaultCode;

  async function save() {
    setBusy(true);
    setMessage(null);
    const result = await setStoreCurrenciesAction({ codes, defaultCode: current }, locale);
    setBusy(false);
    if (result.ok) {
      setMessage({ ok: true, text: t("saved") });
      router.refresh();
    } else if (result.error === "inUse") {
      setMessage({ ok: false, text: t("inUse", { codes: (result.codes ?? []).join(", ") }) });
      setCodes(enabled);
      setCurrent(defaultCode);
    } else {
      setMessage({ ok: false, text: t(`errors.${result.error === "forbidden" ? "forbidden" : "failed"}`) });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col divide-y rounded-lg border" aria-label={t("enabled")}>
        {codes.map((code) => (
          <li key={code} className="flex items-center justify-between gap-3 p-3" data-currency={code}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="default-currency"
                checked={current === code}
                onChange={() => setCurrent(code)}
                aria-label={t("makeDefault", { code })}
              />
              <span className="font-medium">{labelOf.get(code) ?? code}</span>
              {current === code && <span className="text-xs text-muted-foreground">· {t("default")}</span>}
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!hydrated || codes.length === 1 || current === code}
              onClick={() => setCodes(codes.filter((c) => c !== code))}
            >
              {t("remove")}
            </Button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <label className="sr-only" htmlFor="add-currency">
          {t("add")}
        </label>
        <select id="add-currency" value={adding} onChange={(e) => setAdding(e.target.value)} className={selectClass}>
          <option value="">{t("choose")}</option>
          {available
            .filter((c) => !codes.includes(c.code))
            .map((c) => (
              <option key={c.code} value={c.code}>
                {c.label}
              </option>
            ))}
        </select>
        <Button
          type="button"
          variant="outline"
          disabled={!hydrated || adding === "" || codes.length >= 10}
          onClick={() => {
            setCodes([...codes, adding]);
            setAdding("");
          }}
        >
          {t("add")}
        </Button>
      </div>

      <p className="text-sm text-muted-foreground">{t("help")}</p>
      {message && (
        <p role="status" className={message.ok ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
          {message.text}
        </p>
      )}
      <div>
        <Button type="button" disabled={!hydrated || busy || !dirty} onClick={save}>
          {busy ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  );
}
