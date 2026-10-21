"use client";

import { useStoreId } from "@/components/panel-scope";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRightIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { ADJUST_MODES, MANUAL_REASONS, stockAfter, type AdjustMode, type InventoryReason } from "@/lib/inventory";
import { formatMoney, minorToInput } from "@/lib/money";
import { useHydrated } from "@/lib/use-hydrated";
import { createStockAdjustmentSchema, type StockAdjustmentValues } from "@/lib/validation/inventory";
import type { FormCurrency } from "@/lib/validation/product";
import { adjustStockAction, type InventoryActionResult } from "@/server/inventory-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { InventoryRow } from "./inventory-table";

type ErrorKey = "forbidden" | "notFound" | "untracked" | "stale" | "failed";

/** Add units, take units out or set the count of one tracked variant (row = null: closed). */
export function AdjustStockDialog({
  row,
  baseCurrency,
  onOpenChange,
}: {
  row: InventoryRow | null;
  baseCurrency: FormCurrency;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={row !== null && row.stock !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {row && row.stock !== null && (
          // Remounted per variant; a refreshed stock (after `stale`) flows in and is what the next try sends
          <AdjustStockForm
            key={row.id}
            row={row}
            stock={row.stock}
            baseCurrency={baseCurrency}
            onDone={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AdjustStockForm({
  row,
  stock,
  baseCurrency,
  onDone,
}: {
  row: InventoryRow;
  stock: number;
  baseCurrency: FormCurrency;
  onDone: () => void;
}) {
  const storeId = useStoreId();
  const t = useTranslations("Inventory.adjust");
  const tr = useTranslations("Inventory.reasons");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [message, setMessage] = useState<ErrorKey | null>(null);

  // Not memoized: useForm reads the resolver on every render, a new schema per render is cheap
  const schema = createStockAdjustmentSchema(tv, { stock, digits: baseCurrency.digits });
  const form = useForm<StockAdjustmentValues>({
    resolver: zodResolver(schema),
    defaultValues: { mode: "add", reason: MANUAL_REASONS.add[0], quantity: "", unitCost: "", note: "" },
  });
  const [mode, reason, quantity] = useWatch({ control: form.control, name: ["mode", "reason", "quantity"] });
  const typed = /^\d{1,10}$/.test(quantity) ? Number(quantity) : null;
  const next = typed === null ? null : stockAfter(stock, mode, typed);
  const name = row.title ? `${row.productName} (${row.title})` : row.productName;
  const currentCost = row.cost?.currencyCode === baseCurrency.code ? row.cost.minor : null;

  function chooseMode(value: AdjustMode) {
    form.setValue("mode", value);
    form.setValue("reason", MANUAL_REASONS[value][0]);
    if (form.formState.isSubmitted) void form.trigger("quantity");
  }

  async function onSubmit(values: StockAdjustmentValues) {
    setMessage(null);
    const result: InventoryActionResult | null = await adjustStockAction(storeId, row.id, stock, values, locale).catch(() => null);
    if (result?.ok) {
      toast.success(t("toasts.saved", { name }));
      onDone();
      router.refresh();
      return;
    }
    if (result?.error === "invalid" && result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        form.setError(field as keyof StockAdjustmentValues, { message: messages[0] });
      }
      return;
    }
    // Someone else (or an order) changed the stock: show the new numbers
    if (result?.error === "stale") router.refresh();
    const known: ErrorKey[] = ["forbidden", "notFound", "untracked", "stale"];
    setMessage(known.find((key) => key === result?.error) ?? "failed");
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description", { name, stock })}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <FieldSet>
          <FieldLegend variant="label">{t("modeLabel")}</FieldLegend>
          <RadioGroup value={mode} onValueChange={(value) => chooseMode(value as AdjustMode)} className="grid gap-2 sm:grid-cols-3">
            {ADJUST_MODES.map((option) => (
              <FieldLabel key={option} htmlFor={`adjust-mode-${option}`}>
                <Field orientation="horizontal">
                  <RadioGroupItem value={option} id={`adjust-mode-${option}`} />
                  <span className="text-sm font-medium">{t(`mode.${option}`)}</span>
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
        </FieldSet>

        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="quantity"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="adjust-quantity">{t(`quantity.${mode}`)}</FieldLabel>
                <Input
                  {...field}
                  id="adjust-quantity"
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder={t(`quantityPlaceholder.${mode}`)}
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          {mode !== "set" && (
            <Controller
              name="reason"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="adjust-reason">{t("reasonLabel")}</FieldLabel>
                  <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                    <SelectTrigger id="adjust-reason" className="w-full">
                      <SelectValue>{(value: InventoryReason) => tr(value)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {MANUAL_REASONS[mode].map((option) => (
                        <SelectItem key={option} value={option}>
                          {tr(option)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            />
          )}
        </div>

        <p className="flex items-center gap-2 text-sm" aria-live="polite">
          <span className="text-muted-foreground">{t("preview")}</span>
          <span className="tabular-nums">{stock.toLocaleString(locale)}</span>
          <ArrowRightIcon className="size-4 text-muted-foreground" aria-hidden />
          <span className="font-semibold tabular-nums">{next === null ? "—" : next.toLocaleString(locale)}</span>
        </p>

        {reason === "received" && (
          <Controller
            name="unitCost"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="adjust-cost">{t("unitCost")}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    {...field}
                    id="adjust-cost"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={
                      currentCost !== null
                        ? minorToInput(currentCost, baseCurrency.digits)
                        : t("unitCostPlaceholder")
                    }
                    aria-invalid={fieldState.invalid}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>{baseCurrency.code}</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>
                  {currentCost !== null
                    ? t("unitCostHelpAverage", { cost: formatMoney(currentCost, baseCurrency.code, locale) })
                    : t("unitCostHelp")}
                </FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        )}

        <Controller
          name="note"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="adjust-note">{t("note")}</FieldLabel>
              <Textarea {...field} id="adjust-note" rows={2} placeholder={t("notePlaceholder")} aria-invalid={fieldState.invalid} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>
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
