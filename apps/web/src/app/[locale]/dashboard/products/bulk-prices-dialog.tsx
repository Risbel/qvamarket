"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { ADJUST_MAX_PERCENT, ADJUST_MIN_PERCENT, parsePercent } from "@/lib/money";
import type { FormCurrency } from "@/lib/validation/product";
import { adjustPricesAction, setPricesAutoAction } from "@/server/product-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";

export type BulkPricesMode = "auto" | "adjust";

/**
 * Confirms a bulk price change on the selected products in one currency: "auto" (their
 * manual prices go, they follow the rate) or "adjust" (manual prices +/- a percentage).
 * `manualCount` = selected products with manual prices in that currency (the ones touched).
 */
export function BulkPricesDialog({
  mode,
  onOpenChange,
  productIds,
  manualCount,
  currency,
  baseCode,
  onDone,
}: {
  mode: BulkPricesMode | null;
  onOpenChange: (open: boolean) => void;
  productIds: string[];
  manualCount: number;
  currency: FormCurrency;
  baseCode: string;
  onDone: () => void;
}) {
  const t = useTranslations("Products.bulk");
  const router = useRouter();
  const [percent, setPercent] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const basisPoints = parsePercent(percent);
  const count = productIds.length;
  const skipped = count - manualCount;

  function close(next: boolean) {
    if (pending) return;
    if (!next) {
      setError(null);
      setPercent("");
    }
    onOpenChange(next);
  }

  async function confirm() {
    if (!mode) return;
    setPending(true);
    setError(null);
    const input = { productIds, currencyCode: currency.code };
    const result =
      mode === "auto" ? await setPricesAutoAction(input) : await adjustPricesAction({ ...input, percent });
    setPending(false);
    if (result.ok) {
      toast.success(t(mode === "auto" ? "toasts.auto" : "toasts.adjusted", { count: result.changed, currency: currency.code }));
      setPercent("");
      onOpenChange(false);
      onDone();
      router.refresh();
      return;
    }
    const known = ["forbidden", "noRate", "isBase", "tooHigh"] as const;
    setError(t(`errors.${known.find((key) => key === result.error) ?? "failed"}`));
  }

  const disabled = pending || (mode === "adjust" && (basisPoints === null || manualCount === 0)) || (mode === "auto" && manualCount === 0);

  return (
    <Dialog open={mode !== null} onOpenChange={close}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{mode === "adjust" ? t("adjustTitle", { currency: currency.code }) : t("autoTitle", { currency: currency.code })}</DialogTitle>
          <DialogDescription>
            {mode === "auto" &&
              t("autoConfirm", { count: manualCount, currency: currency.code, base: baseCode, rate: currency.rate ?? "" })}
            {mode === "adjust" &&
              (currency.isBase
                ? t("adjustConfirmBase", { count: manualCount, currency: currency.code })
                : t("adjustConfirm", { count: manualCount, currency: currency.code }))}
          </DialogDescription>
        </DialogHeader>

        {skipped > 0 && (
          <p className="text-sm text-muted-foreground">
            {mode === "auto"
              ? t("autoSkipped", { count: skipped })
              : currency.isBase
                ? t("adjustSkippedBase", { count: skipped, currency: currency.code })
                : t("adjustSkipped", { count: skipped, currency: currency.code })}
          </p>
        )}

        {mode === "adjust" && (
          <Field data-invalid={percent !== "" && basisPoints === null}>
            <FieldLabel htmlFor="bulk-percent">{t("percent")}</FieldLabel>
            <InputGroup className="w-40">
              <InputGroupInput
                id="bulk-percent"
                inputMode="decimal"
                autoComplete="off"
                placeholder={t("percentPlaceholder")}
                value={percent}
                onChange={(event) => setPercent(event.target.value.replace(/[^\d.,+-]/g, "").slice(0, 8))}
                aria-invalid={percent !== "" && basisPoints === null}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>%</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>{t("percentHelp")}</FieldDescription>
            {percent !== "" && basisPoints === null && (
              <FieldError>{t("percentInvalid", { min: ADJUST_MIN_PERCENT, max: ADJUST_MAX_PERCENT })}</FieldError>
            )}
          </Field>
        )}

        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={pending}>
            {t("cancel")}
          </Button>
          <Button onClick={confirm} disabled={disabled}>
            {pending ? t("applying") : t("apply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
