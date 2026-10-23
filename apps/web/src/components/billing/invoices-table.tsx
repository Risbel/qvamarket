"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import {
  BILLING_PAYMENT_METHODS,
  INVOICE_BADGE,
  formatInvoiceNumber,
  isOverdue,
  type BillingCycle,
  type BillingPaymentMethod,
  type InvoiceKind,
  type InvoiceStatus,
} from "@/lib/billing";
import { currencyDigits, formatMoney, minorToInput } from "@/lib/money";
import type { PlanKey } from "@/lib/plans";
import { useHydrated } from "@/lib/use-hydrated";
import { createBillingPaymentSchema, createVoidInvoiceSchema, type BillingPaymentValues } from "@/lib/validation/billing";
import { recordBillingPaymentAction, voidInvoiceAction } from "@/server/billing-actions";
import { DateTimePicker } from "@/components/date-time-picker";
import { LocalDateTime, localInputToIso } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type InvoiceView = {
  id: string;
  number: number;
  kind: InvoiceKind;
  planKey: PlanKey | null;
  cycle: BillingCycle | null;
  periodStart: string | null;
  periodEnd: string | null;
  amountMinor: number;
  currencyCode: string;
  status: InvoiceStatus;
  dueAt: string;
  paidAt: string | null;
  voidReason: string | null;
  note: string | null;
  totals: { paid: number; refunded: number; net: number; due: number };
  payments: {
    id: string;
    kind: "payment" | "refund";
    method: string;
    amountMinor: number;
    reference: string | null;
    paidAt: string;
    note: string | null;
    recordedBy: string | null;
  }[];
};

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A company's invoices, newest first, each with its payments. The superadmin records payments /
 * refunds and voids invoices; `readOnly` (the company's own Billing page) shows no actions and
 * leaves out the internal notes (only a manual invoice's description is shown).
 */
export function InvoicesTable({ invoices, readOnly = false }: { invoices: InvoiceView[]; readOnly?: boolean }) {
  const t = useTranslations("Billing.invoices");
  const tp = useTranslations("Plans.plans");
  const tc = useTranslations("Billing.cycles");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [paying, setPaying] = useState<InvoiceView | null>(null);
  const [voiding, setVoiding] = useState<InvoiceView | null>(null);
  // Overdue depends on the clock: decided in the browser, after hydration
  const [now] = useState(() => new Date());

  if (invoices.length === 0) return <p className="text-muted-foreground">{t("empty")}</p>;

  const done = (message: string) => {
    toast.success(message);
    setPaying(null);
    setVoiding(null);
    router.refresh();
  };

  return (
    <>
      <ul className="flex flex-col divide-y">
        {invoices.map((invoice) => {
          const money = (minor: number) => formatMoney(minor, invoice.currencyCode, locale);
          const overdue = hydrated && isOverdue({ status: invoice.status, dueAt: new Date(invoice.dueAt) }, now);
          const badge = overdue ? "overdue" : invoice.status;
          const open = invoice.status !== "void";
          return (
            <li key={invoice.id} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium tabular-nums">{formatInvoiceNumber(invoice.number)}</span>
                    <Badge variant={INVOICE_BADGE[badge]}>{t(`status.${badge}`)}</Badge>
                  </div>
                  <span className="text-sm">
                    {t(`kind.${invoice.kind}`)}
                    {invoice.planKey && ` · ${tp(`${invoice.planKey}.name`)}`}
                    {invoice.cycle && ` · ${tc(invoice.cycle)}`}
                  </span>
                  {invoice.periodStart && invoice.periodEnd && (
                    <span className="text-xs text-muted-foreground">
                      <LocalDateTime iso={invoice.periodStart} locale={locale} /> – <LocalDateTime iso={invoice.periodEnd} locale={locale} />
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {invoice.paidAt ? t("paidOn") : t("dueOn")} <LocalDateTime iso={invoice.paidAt ?? invoice.dueAt} locale={locale} />
                  </span>
                  {invoice.note && (!readOnly || invoice.kind === "manual") && (
                    <span className="text-sm whitespace-pre-line">{invoice.note}</span>
                  )}
                  {invoice.voidReason && (
                    <span className="text-sm text-muted-foreground">
                      {t("voidReason", { reason: invoice.voidReason === "replaced" ? t("replaced") : invoice.voidReason })}
                    </span>
                  )}
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="font-semibold tabular-nums">{money(invoice.amountMinor)}</span>
                  {invoice.totals.net > 0 && invoice.status !== "paid" && (
                    <span className="text-xs text-muted-foreground">{t("collected", { amount: money(invoice.totals.net) })}</span>
                  )}
                  {invoice.totals.refunded > 0 && (
                    <span className="text-xs text-muted-foreground">{t("refunded", { amount: money(invoice.totals.refunded) })}</span>
                  )}
                  {open && !readOnly && (
                    <div className="flex flex-wrap justify-end gap-2">
                      {(invoice.totals.due > 0 || invoice.totals.net > 0) && (
                        <Button size="sm" variant="outline" disabled={!hydrated} onClick={() => setPaying(invoice)}>
                          {invoice.totals.due > 0 ? t("record") : t("recordRefund")}
                        </Button>
                      )}
                      {invoice.totals.net === 0 && (
                        <Button size="sm" variant="ghost" disabled={!hydrated} onClick={() => setVoiding(invoice)}>
                          {t("void")}
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {invoice.payments.length > 0 && (
                <ul className="ml-3 flex flex-col gap-1 border-l pl-3 text-sm">
                  {invoice.payments.map((p) => (
                    <li key={p.id} className="flex flex-wrap justify-between gap-x-3">
                      <span>
                        <Badge variant={p.kind === "refund" ? "destructive" : "secondary"} className="mr-1.5">
                          {t(`paymentKind.${p.kind}`)}
                        </Badge>
                        {t(`method.${p.method as BillingPaymentMethod}`)}
                        {p.reference && ` · ${p.reference}`}
                        <span className="block text-xs text-muted-foreground">
                          <LocalDateTime iso={p.paidAt} locale={locale} />
                          {!readOnly && p.recordedBy && ` · ${p.recordedBy}`}
                          {!readOnly && p.note && ` · ${p.note}`}
                        </span>
                      </span>
                      <span className="tabular-nums">
                        {p.kind === "refund" ? "−" : ""}
                        {money(p.amountMinor)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>

      <Dialog open={paying !== null} onOpenChange={(open) => !open && setPaying(null)}>
        <DialogContent>
          {paying && (
            <PaymentForm
              invoice={paying}
              onDone={(kind) => done(t(kind === "refund" ? "toasts.refundRecorded" : "toasts.paymentRecorded"))}
              onCancel={() => setPaying(null)}
            />
          )}
        </DialogContent>
      </Dialog>
      <Dialog open={voiding !== null} onOpenChange={(open) => !open && setVoiding(null)}>
        <DialogContent>
          {voiding && <VoidForm invoice={voiding} onDone={() => done(t("toasts.voided"))} onCancel={() => setVoiding(null)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function PaymentForm({
  invoice,
  onDone,
  onCancel,
}: {
  invoice: InvoiceView;
  onDone: (kind: "payment" | "refund") => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Billing.payment");
  const ti = useTranslations("Billing.invoices");
  const ta = useTranslations("Billing.actions");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const hydrated = useHydrated();
  const [message, setMessage] = useState<string | null>(null);
  const [now] = useState(() => new Date());
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const digits = currencyDigits(invoice.currencyCode);
  const kinds = [...(invoice.totals.due > 0 ? (["payment"] as const) : []), ...(invoice.totals.net > 0 ? (["refund"] as const) : [])];
  const suggested = (kind: "payment" | "refund") => minorToInput(kind === "payment" ? invoice.totals.due : invoice.totals.net, digits);

  const form = useForm<BillingPaymentValues>({
    resolver: zodResolver(createBillingPaymentSchema(tv, digits)),
    defaultValues: { kind: kinds[0], method: "transfer", amount: suggested(kinds[0]), reference: "", paidAt: "", note: "" },
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const money = (minor: number) => formatMoney(minor, invoice.currencyCode, locale);

  async function onSubmit(values: BillingPaymentValues) {
    setMessage(null);
    const result = await recordBillingPaymentAction(invoice.id, { ...values, paidAt: values.paidAt ? localInputToIso(values.paidAt) : "" }, locale).catch(
      () => null,
    );
    if (result?.ok) return onDone(values.kind);
    if (result?.error === "invalid" && result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) form.setError(field as keyof BillingPaymentValues, { message: messages[0] });
      return;
    }
    setMessage(ta(`errors.${result && !result.ok ? result.error : "failed"}`, { amount: money(kind === "payment" ? invoice.totals.due : invoice.totals.net) }));
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t(kind === "refund" ? "refundTitle" : "title", { number: formatInvoiceNumber(invoice.number) })}</DialogTitle>
        <DialogDescription>
          {t("summary", { due: money(invoice.totals.due), collected: money(invoice.totals.net) })}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        {kinds.length > 1 && (
          <Controller
            name="kind"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="billing-payment-kind">{t("kind")}</FieldLabel>
                <Select
                  value={field.value}
                  onValueChange={(value) => {
                    if (!value) return;
                    field.onChange(value);
                    form.setValue("amount", suggested(value as "payment" | "refund"));
                  }}
                >
                  <SelectTrigger id="billing-payment-kind" className="w-full">
                    <SelectValue>{(value: "payment" | "refund") => ti(`paymentKind.${value}`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {kinds.map((option) => (
                      <SelectItem key={option} value={option}>
                        {ti(`paymentKind.${option}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="amount"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="billing-payment-amount">{t("amount")}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    {...field}
                    id="billing-payment-amount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={suggested(kind)}
                    aria-invalid={fieldState.invalid}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>{invoice.currencyCode}</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            name="method"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="billing-payment-method">{t("method")}</FieldLabel>
                <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                  <SelectTrigger id="billing-payment-method" className="w-full">
                    <SelectValue>{(value: BillingPaymentMethod) => ti(`method.${value}`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {BILLING_PAYMENT_METHODS.map((method) => (
                      <SelectItem key={method} value={method}>
                        {ti(`method.${method}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
        </div>
        <Controller
          name="reference"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="billing-payment-reference">{t("reference")}</FieldLabel>
              <Input {...field} id="billing-payment-reference" autoComplete="off" placeholder={t("referencePlaceholder")} aria-invalid={fieldState.invalid} />
              <FieldDescription>{t("referenceHelp")}</FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="paidAt"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="billing-payment-date">{t(kind === "refund" ? "refundedAt" : "paidAt")}</FieldLabel>
              <DateTimePicker
                id="billing-payment-date"
                value={field.value}
                onChange={field.onChange}
                defaultTime={`${pad(now.getHours())}:${pad(now.getMinutes())}`}
                maxDate={now}
                locale={locale}
                invalid={fieldState.invalid}
                labels={{ placeholder: ta("datePlaceholder"), time: ta("time"), clear: ta("dateClear") }}
              />
              <FieldDescription>
                {t("paidAtHelp")} {ta("timeZone", { zone: timeZone })}
              </FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="note"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="billing-payment-note">{ta("note")}</FieldLabel>
              <Textarea {...field} id="billing-payment-note" rows={2} placeholder={ta("notePlaceholder")} aria-invalid={fieldState.invalid} />
              <FieldError errors={[fieldState.error]} />
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
        <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={onCancel}>
          {ta("back")}
        </Button>
        <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
          {t(kind === "refund" ? "saveRefund" : "save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

function VoidForm({ invoice, onDone, onCancel }: { invoice: InvoiceView; onDone: () => void; onCancel: () => void }) {
  const t = useTranslations("Billing.voidInvoice");
  const ta = useTranslations("Billing.actions");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const hydrated = useHydrated();
  const [message, setMessage] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(createVoidInvoiceSchema(tv)), defaultValues: { reason: "" } });

  async function onSubmit(values: { reason: string }) {
    setMessage(null);
    const result = await voidInvoiceAction(invoice.id, values, locale).catch(() => null);
    if (result?.ok) return onDone();
    if (result?.error === "invalid" && result.fieldErrors?.reason) {
      form.setError("reason", { message: result.fieldErrors.reason[0] });
      return;
    }
    setMessage(ta(`errors.${result && !result.ok ? result.error : "failed"}`, { amount: "" }));
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t("title", { number: formatInvoiceNumber(invoice.number) })}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <Controller
        name="reason"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor="void-reason">{t("reason")}</FieldLabel>
            <Textarea {...field} id="void-reason" rows={2} placeholder={t("reasonPlaceholder")} aria-invalid={fieldState.invalid} />
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={onCancel}>
          {ta("back")}
        </Button>
        <Button type="submit" variant="destructive" disabled={!hydrated || form.formState.isSubmitting}>
          {t("submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
