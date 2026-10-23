"use client";

import { useState } from "react";
import { Controller, useFieldArray, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2Icon, PlusIcon, PrinterIcon, XIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import type { CountryOption } from "@/components/country-select";
import { useStoreId, useStorePath } from "@/components/panel-scope";
import { PhoneInput } from "@/components/phone-input";
import { Button, buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { Link, useRouter } from "@/i18n/navigation";
import { formatMoney, minorToInput, parsePriceToMinor } from "@/lib/money";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/orders";
import { POS_MAX_PAYMENTS, quickCashAmounts, type TicketItem } from "@/lib/pos";
import { useHydrated } from "@/lib/use-hydrated";
import { createPosChargeSchema, type PosChargeValues } from "@/lib/validation/pos";
import { placePosSaleAction } from "@/server/pos-actions";

export type CompletedSale = { orderId: string; totalMinor: number; changeMinor: number; pendingMinor: number };

/**
 * Charging a ticket: one or more payments (cash, transfer, other; a transfer can carry the
 * bank reference), the cash handed over (only to work out the change), "charge later" when
 * less than the total is paid now, and an optional customer and note.
 */
export function ChargeForm({
  currency,
  digits,
  totalMinor,
  items,
  saleKey,
  phoneCountries,
  phoneCountry,
  onCancel,
  onDone,
}: {
  currency: string;
  digits: number;
  totalMinor: number;
  items: TicketItem[];
  saleKey: string;
  phoneCountries: CountryOption[];
  phoneCountry: string;
  onCancel: () => void;
  onDone: (sale: CompletedSale) => void;
}) {
  const storeId = useStoreId();
  const storePathOf = useStorePath();
  const t = useTranslations("Pos.charge");
  const tm = useTranslations("Orders.payments");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [message, setMessage] = useState<{ text: string; register?: boolean } | null>(null);
  const money = (minor: number) => formatMoney(minor, currency, locale);
  const toMinor = (value: string | undefined) => (value?.trim() ? (parsePriceToMinor(value, digits, Number.MAX_SAFE_INTEGER) ?? 0) : 0);

  const form = useForm<PosChargeValues>({
    resolver: zodResolver(createPosChargeSchema(tv, currency, digits, totalMinor, locale)),
    defaultValues: {
      payments: [{ method: "cash", amount: minorToInput(totalMinor, digits), reference: "" }],
      received: "",
      payLater: false,
      customerName: "",
      customerPhone: "",
      phoneCountry,
      note: "",
    },
  });
  const payments = useFieldArray({ control: form.control, name: "payments" });
  const watched = useWatch({ control: form.control, name: "payments" });
  const received = useWatch({ control: form.control, name: "received" });
  const payLater = useWatch({ control: form.control, name: "payLater" });

  const paidMinor = (watched ?? []).reduce((sum, p) => sum + toMinor(p.amount), 0);
  const cashMinor = (watched ?? []).reduce((sum, p) => sum + (p.method === "cash" ? toMinor(p.amount) : 0), 0);
  const receivedMinor = toMinor(received);
  const changeMinor = receivedMinor > cashMinor ? receivedMinor - cashMinor : 0;
  const pendingMinor = Math.max(totalMinor - paidMinor, 0);

  async function onSubmit(values: PosChargeValues) {
    setMessage(null);
    const { received: _received, ...charge } = values;
    void _received;
    const result = await placePosSaleAction(
      storeId,
      { ...charge, currencyCode: currency, items, expectedTotalMinor: totalMinor, idempotencyKey: saleKey },
      locale,
    ).catch(() => null);
    if (result?.ok) {
      toast.success(t("toast"));
      onDone({ orderId: result.orderId, totalMinor, changeMinor, pendingMinor: payLater ? pendingMinor : 0 });
      return;
    }
    if (result?.error === "ticketChanged") {
      // prices or stock changed: reload the catalog so the ticket shows the new amounts
      toast.error(t("errors.ticketChanged"));
      router.refresh();
      onCancel();
      return;
    }
    const error = result?.error ?? "failed";
    setMessage({ text: t(`errors.${error}`), register: error === "noShift" });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription className="text-3xl font-semibold text-foreground tabular-nums">{money(totalMinor)}</DialogDescription>
      </DialogHeader>

      <FieldSet>
        <FieldLegend variant="label">{t("payments")}</FieldLegend>
        <FieldGroup className="gap-3">
          {payments.fields.map((item, index) => {
            const method = watched?.[index]?.method ?? item.method;
            return (
              <div key={item.id} className="flex flex-col gap-2 rounded-lg border p-3">
                <div className="flex items-start gap-2">
                  <Controller
                    name={`payments.${index}.method`}
                    control={form.control}
                    render={({ field }) => (
                      <Field className="w-36 shrink-0">
                        <FieldLabel htmlFor={`pay-method-${index}`} className="sr-only">
                          {t("method")}
                        </FieldLabel>
                        <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                          <SelectTrigger id={`pay-method-${index}`} className="w-full">
                            <SelectValue>{(value: PaymentMethod) => tm(`method.${value}`)}</SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {PAYMENT_METHODS.map((m) => (
                              <SelectItem key={m} value={m}>
                                {tm(`method.${m}`)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </Field>
                    )}
                  />
                  <Controller
                    name={`payments.${index}.amount`}
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid} className="min-w-0 flex-1">
                        <FieldLabel htmlFor={`pay-amount-${index}`} className="sr-only">
                          {t("amount")}
                        </FieldLabel>
                        <InputGroup>
                          <InputGroupInput
                            {...field}
                            id={`pay-amount-${index}`}
                            inputMode="decimal"
                            autoComplete="off"
                            placeholder={minorToInput(totalMinor, digits)}
                            aria-invalid={fieldState.invalid}
                          />
                          <InputGroupAddon align="inline-end">
                            <InputGroupText>{currency}</InputGroupText>
                          </InputGroupAddon>
                        </InputGroup>
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />
                  {(payments.fields.length > 1 || payLater) && (
                    <Button type="button" size="icon" variant="ghost" aria-label={t("removePayment")} onClick={() => payments.remove(index)}>
                      <XIcon />
                    </Button>
                  )}
                </div>
                {method !== "cash" && (
                  <Controller
                    name={`payments.${index}.reference`}
                    control={form.control}
                    render={({ field, fieldState }) => (
                      <Field data-invalid={fieldState.invalid}>
                        <FieldLabel htmlFor={`pay-reference-${index}`}>{t("reference")}</FieldLabel>
                        <Input {...field} id={`pay-reference-${index}`} placeholder={t("referencePlaceholder")} autoComplete="off" aria-invalid={fieldState.invalid} />
                        <FieldError errors={[fieldState.error]} />
                      </Field>
                    )}
                  />
                )}
              </div>
            );
          })}
          {payments.fields.length < POS_MAX_PAYMENTS && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => payments.append({ method: "transfer", amount: pendingMinor > 0 ? minorToInput(pendingMinor, digits) : "", reference: "" })}
            >
              <PlusIcon />
              {t("addPayment")}
            </Button>
          )}
          <FieldError errors={[form.formState.errors.payments?.root ?? (form.formState.errors.payments as { message?: string } | undefined)]} />
        </FieldGroup>
      </FieldSet>

      {cashMinor > 0 && (
        <Controller
          name="received"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="pay-received">{t("received")}</FieldLabel>
              <InputGroup>
                <InputGroupInput
                  {...field}
                  id="pay-received"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={minorToInput(cashMinor, digits)}
                  aria-invalid={fieldState.invalid}
                />
                <InputGroupAddon align="inline-end">
                  <InputGroupText>{currency}</InputGroupText>
                </InputGroupAddon>
              </InputGroup>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="outline" onClick={() => field.onChange("")}>
                  {t("exact")}
                </Button>
                {quickCashAmounts(cashMinor, digits).map((amount) => (
                  <Button key={amount} type="button" size="sm" variant="outline" onClick={() => field.onChange(minorToInput(amount, digits))}>
                    {money(amount)}
                  </Button>
                ))}
              </div>
              <FieldError errors={[fieldState.error]} />
              {changeMinor > 0 && (
                <p className="text-lg font-semibold tabular-nums" aria-live="polite">
                  {t("change", { amount: money(changeMinor) })}
                </p>
              )}
            </Field>
          )}
        />
      )}

      {paidMinor < totalMinor && (
        <Controller
          name="payLater"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field orientation="horizontal" data-invalid={fieldState.invalid}>
              <Checkbox id="pay-later" checked={field.value} onCheckedChange={(checked) => field.onChange(checked === true)} />
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="pay-later">{t("payLater", { amount: money(totalMinor - paidMinor) })}</FieldLabel>
                <FieldDescription>{t("payLaterHelp")}</FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </div>
            </Field>
          )}
        />
      )}

      <Separator />

      <FieldSet>
        <FieldLegend variant="label">{t("customer")}</FieldLegend>
        <FieldDescription>{t("customerHelp")}</FieldDescription>
        <FieldGroup className="gap-3 sm:flex-row">
          <Controller
            name="customerName"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="pos-customer-name">{t("customerName")}</FieldLabel>
                <Input {...field} id="pos-customer-name" placeholder={t("customerNamePlaceholder")} autoComplete="off" aria-invalid={fieldState.invalid} />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            name="customerPhone"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="pos-customer-phone">{t("customerPhone")}</FieldLabel>
                <Controller
                  name="phoneCountry"
                  control={form.control}
                  render={({ field: country }) => (
                    <PhoneInput
                      {...field}
                      id="pos-customer-phone"
                      country={country.value}
                      onCountryChange={country.onChange}
                      options={phoneCountries}
                      countryLabel={t("country")}
                      countryPlaceholder={t("country")}
                      placeholder={t("customerPhonePlaceholder")}
                      autoComplete="off"
                      invalid={fieldState.invalid}
                    />
                  )}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </FieldGroup>
      </FieldSet>

      <Controller
        name="note"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor="pos-note">{t("note")}</FieldLabel>
            <Textarea {...field} id="pos-note" rows={2} placeholder={t("notePlaceholder")} aria-invalid={fieldState.invalid} />
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />

      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message.text}{" "}
          {message.register && (
            <Link href={storePathOf("/register")} className="font-medium underline underline-offset-4">
              {t("openRegister")}
            </Link>
          )}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={onCancel}>
          {t("back")}
        </Button>
        <Button type="submit" size="lg" disabled={!hydrated || form.formState.isSubmitting}>
          {paidMinor === 0 ? t("submitLater") : t("submit", { amount: money(Math.min(paidMinor, totalMinor)) })}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** After the sale: the change to hand back first, then the receipt and the next sale. */
export function SaleDone({ sale, currency, onNext }: { sale: CompletedSale; currency: string; onNext: () => void }) {
  const t = useTranslations("Pos.done");
  const locale = useLocale();
  const storePathOf = useStorePath();
  const money = (minor: number) => formatMoney(minor, currency, locale);
  return (
    <div className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <CheckCircle2Icon className="text-primary" aria-hidden />
          {t("title")}
        </DialogTitle>
        <DialogDescription>{t("total", { amount: money(sale.totalMinor) })}</DialogDescription>
      </DialogHeader>
      {sale.changeMinor > 0 && (
        <div className="rounded-lg bg-muted p-4 text-center">
          <p className="text-sm text-muted-foreground">{t("change")}</p>
          <p className="text-4xl font-semibold tabular-nums">{money(sale.changeMinor)}</p>
        </div>
      )}
      {sale.pendingMinor > 0 && <p className="text-sm">{t("pending", { amount: money(sale.pendingMinor) })}</p>}
      <DialogFooter className="gap-2 sm:justify-between">
        <div className="flex gap-2">
          <Link href={storePathOf(`/orders/${sale.orderId}/receipt`)} target="_blank" className={buttonVariants({ variant: "outline" })}>
            <PrinterIcon />
            {t("receipt")}
          </Link>
          <Link href={storePathOf(`/orders/${sale.orderId}`)} className={buttonVariants({ variant: "ghost" })}>
            {t("viewOrder")}
          </Link>
        </div>
        <Button size="lg" autoFocus onClick={onNext}>
          {t("next")}
        </Button>
      </DialogFooter>
    </div>
  );
}
