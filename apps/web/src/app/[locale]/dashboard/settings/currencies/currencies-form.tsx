"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { setStoreCurrenciesAction } from "@/server/catalog-actions";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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
  const [formError, setFormError] = useState<string | null>(null);
  const labelOf = new Map(available.map((c) => [c.code, c.label]));
  const dirty = codes.join() !== enabled.join() || current !== defaultCode;

  async function save() {
    setBusy(true);
    setFormError(null);
    const result = await setStoreCurrenciesAction({ codes, defaultCode: current }, locale);
    setBusy(false);
    if (result.ok) {
      toast.success(t("saved"));
      router.refresh();
    } else if (result.error === "inUse") {
      setFormError(t("inUse", { codes: (result.codes ?? []).join(", ") }));
      setCodes(enabled);
      setCurrent(defaultCode);
    } else {
      setFormError(t(`errors.${result.error === "forbidden" ? "forbidden" : "failed"}`));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <RadioGroup
        value={current}
        onValueChange={(value) => typeof value === "string" && setCurrent(value)}
        aria-label={t("enabled")}
        className="flex flex-col gap-0 divide-y rounded-lg border"
      >
        {codes.map((code) => (
          <div key={code} className="flex items-center justify-between gap-3 p-3" data-currency={code}>
            <label className="flex items-center gap-2 text-sm">
              <RadioGroupItem value={code} aria-label={t("makeDefault", { code })} />
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
          </div>
        ))}
      </RadioGroup>

      <div className="flex gap-2">
        <label className="sr-only" htmlFor="add-currency">
          {t("add")}
        </label>
        <Select value={adding || null} onValueChange={(value) => setAdding(typeof value === "string" ? value : "")}>
          <SelectTrigger id="add-currency" className="min-w-0 flex-1">
            <SelectValue placeholder={t("choose")}>
              {(code: string | null) => (code ? (labelOf.get(code) ?? code) : t("choose"))}
            </SelectValue>
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false} align="start">
            {available
              .filter((c) => !codes.includes(c.code))
              .map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.label}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
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
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
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
