"use client";

import { useStoreId } from "@/components/panel-scope";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { formatMoney, minorToInput } from "@/lib/money";
import { useHydrated } from "@/lib/use-hydrated";
import { createCostSchema, type CostValues } from "@/lib/validation/inventory";
import type { FormCurrency } from "@/lib/validation/product";
import { setVariantCostAction, type InventoryActionResult } from "@/server/inventory-actions";
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
import type { InventoryRow } from "./inventory-table";

/** What one unit of a variant cost the store, in the base currency (row = null: closed). */
export function EditCostDialog({
  row,
  baseCurrency,
  onOpenChange,
}: {
  row: InventoryRow | null;
  baseCurrency: FormCurrency;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={row !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {row && <EditCostForm key={row.id} row={row} baseCurrency={baseCurrency} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function EditCostForm({ row, baseCurrency, onDone }: { row: InventoryRow; baseCurrency: FormCurrency; onDone: () => void }) {
  const storeId = useStoreId();
  const t = useTranslations("Inventory.cost");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [message, setMessage] = useState<"forbidden" | "notFound" | "failed" | null>(null);
  const name = row.title ? `${row.productName} (${row.title})` : row.productName;
  // A cost typed in another currency (before the base changed) is shown, not prefilled
  const sameCurrency = row.cost?.currencyCode === baseCurrency.code;

  const form = useForm<CostValues>({
    resolver: zodResolver(createCostSchema(tv, baseCurrency.digits)),
    defaultValues: { cost: row.cost && sameCurrency ? minorToInput(row.cost.minor, baseCurrency.digits) : "" },
  });

  async function onSubmit(values: CostValues) {
    setMessage(null);
    const result: InventoryActionResult | null = await setVariantCostAction(storeId, row.id, values, locale).catch(() => null);
    if (result?.ok) {
      toast.success(t("toasts.saved", { name }));
      onDone();
      router.refresh();
      return;
    }
    if (result?.error === "invalid" && result.fieldErrors?.cost) {
      form.setError("cost", { message: result.fieldErrors.cost[0] });
      return;
    }
    setMessage(result?.error === "forbidden" || result?.error === "notFound" ? result.error : "failed");
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description", { name })}</DialogDescription>
      </DialogHeader>
      <Controller
        name="cost"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor="variant-cost">{t("label")}</FieldLabel>
            <InputGroup className="sm:w-56">
              <InputGroupInput
                {...field}
                id="variant-cost"
                inputMode="decimal"
                autoComplete="off"
                placeholder={t("placeholder")}
                aria-invalid={fieldState.invalid}
              />
              <InputGroupAddon align="inline-end">
                <InputGroupText>{baseCurrency.code}</InputGroupText>
              </InputGroupAddon>
            </InputGroup>
            <FieldDescription>
              {row.cost && !sameCurrency
                ? t("otherCurrency", { cost: formatMoney(row.cost.minor, row.cost.currencyCode, locale) })
                : t("help")}
            </FieldDescription>
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${message}`)}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t("saving") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
