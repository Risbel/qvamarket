"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { BILLING_CYCLES, type BillingCycle } from "@/lib/billing";
import { currencyDigits, minorToInput } from "@/lib/money";
import { PLAN_KEYS } from "@/lib/plans";
import { useHydrated } from "@/lib/use-hydrated";
import { createPlanPriceSchema, type PlanPriceValues } from "@/lib/validation/billing";
import { setPlanPriceAction } from "@/server/billing-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

type PaidPlan = Exclude<(typeof PLAN_KEYS)[number], "free">;
const PAID_PLANS = PLAN_KEYS.filter((key): key is PaidPlan => key !== "free");

type Price = { planKey: PaidPlan; cycle: BillingCycle; currencyCode: string; amountMinor: number; isActive: boolean };

function digitsOf(code: string) {
  try {
    return currencyDigits(code);
  } catch {
    return 2;
  }
}

/** Sets a price: a new one (button "New price") or an existing row (plan, cycle and currency fixed). */
export function PriceDialog({ price }: { price?: Price }) {
  const t = useTranslations("Billing.prices");
  const tp = useTranslations("Plans.plans");
  const tc = useTranslations("Billing.cycles");
  const ta = useTranslations("Billing.actions");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const defaults: PlanPriceValues = price
    ? { ...price, amount: minorToInput(price.amountMinor, digitsOf(price.currencyCode)) }
    : { planKey: "basic", cycle: "monthly", currencyCode: "USD", amount: "", isActive: true };
  const form = useForm<PlanPriceValues>({ resolver: zodResolver(createPlanPriceSchema(tv)), defaultValues: defaults });
  const currencyCode = useWatch({ control: form.control, name: "currencyCode" });

  function onOpenChange(next: boolean) {
    if (form.formState.isSubmitting) return;
    setOpen(next);
    if (!next) {
      form.reset(defaults);
      setMessage(null);
    }
  }

  async function onSubmit(values: PlanPriceValues) {
    setMessage(null);
    const result = await setPlanPriceAction(values, locale).catch(() => null);
    if (result?.ok) {
      toast.success(t("toasts.saved"));
      setOpen(false);
      router.refresh();
      return;
    }
    if (result?.error === "invalid" && result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) form.setError(field as keyof PlanPriceValues, { message: messages[0] });
      return;
    }
    setMessage(ta(`errors.${result && !result.ok ? result.error : "failed"}`, { amount: "" }));
  }

  return (
    <>
      {price ? (
        <Button size="sm" variant="outline" disabled={!hydrated} onClick={() => setOpen(true)}>
          {t("edit")}
        </Button>
      ) : (
        <Button disabled={!hydrated} onClick={() => setOpen(true)}>
          <PlusIcon />
          {t("new")}
        </Button>
      )}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{price ? t("editTitle") : t("newTitle")}</DialogTitle>
              <DialogDescription>{t("dialogDescription")}</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Controller
                  name="planKey"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="price-plan">{t("plan")}</FieldLabel>
                      <Select value={field.value} disabled={Boolean(price)} onValueChange={(value) => value && field.onChange(value)}>
                        <SelectTrigger id="price-plan" className="w-full">
                          <SelectValue>{(value: PaidPlan) => tp(`${value}.name`)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {PAID_PLANS.map((key) => (
                            <SelectItem key={key} value={key}>
                              {tp(`${key}.name`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                />
                <Controller
                  name="cycle"
                  control={form.control}
                  render={({ field }) => (
                    <Field>
                      <FieldLabel htmlFor="price-cycle">{t("cycle")}</FieldLabel>
                      <Select value={field.value} disabled={Boolean(price)} onValueChange={(value) => value && field.onChange(value)}>
                        <SelectTrigger id="price-cycle" className="w-full">
                          <SelectValue>{(value: BillingCycle) => tc(value)}</SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {BILLING_CYCLES.map((key) => (
                            <SelectItem key={key} value={key}>
                              {tc(key)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  )}
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
                <Controller
                  name="currencyCode"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="price-currency">{t("currency")}</FieldLabel>
                      <Input
                        {...field}
                        id="price-currency"
                        maxLength={3}
                        autoComplete="off"
                        placeholder="CUP"
                        readOnly={Boolean(price)}
                        onChange={(event) => field.onChange(event.target.value.toUpperCase())}
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
                <Controller
                  name="amount"
                  control={form.control}
                  render={({ field, fieldState }) => (
                    <Field data-invalid={fieldState.invalid}>
                      <FieldLabel htmlFor="price-amount">{t("amount")}</FieldLabel>
                      <Input
                        {...field}
                        id="price-amount"
                        inputMode="decimal"
                        autoComplete="off"
                        placeholder={digitsOf(/^[A-Z]{3}$/.test(currencyCode) ? currencyCode : "USD") === 0 ? "7500" : "25.00"}
                        aria-invalid={fieldState.invalid}
                      />
                      <FieldError errors={[fieldState.error]} />
                    </Field>
                  )}
                />
              </div>
              <Controller
                name="isActive"
                control={form.control}
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <Switch id="price-active" checked={field.value} onCheckedChange={field.onChange} />
                    <FieldContent>
                      <FieldLabel htmlFor="price-active">{t("activeLabel")}</FieldLabel>
                      <FieldDescription>{t("activeHelp")}</FieldDescription>
                    </FieldContent>
                  </Field>
                )}
              />
            </FieldGroup>
            {message && (
              <p role="alert" className="text-sm text-destructive">
                {message}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={() => onOpenChange(false)}>
                {ta("back")}
              </Button>
              <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
                {t("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
