"use client";

import { useMemo, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { currencyDigits, formatMoney, minorToInput } from "@/lib/money";
import { PAYMENT_METHODS, paymentTotals, type PaymentKind, type PaymentMethod } from "@/lib/orders";
import { useHydrated } from "@/lib/use-hydrated";
import { createPaymentSchema, type PaymentFormValues } from "@/lib/validation/payment";
import { deletePaymentAction, recordPaymentAction, type PaymentActionResult } from "@/server/order-actions";
import { LocalDateTime, localInputToIso } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type PaymentRecord = {
  id: string;
  kind: string;
  method: string;
  amountMinor: number;
  paidAt: string;
  recordedByName: string | null;
  note: string | null;
};

type ErrorKey = "forbidden" | "notFound" | "cancelled" | "unbalanced" | "failed";

/**
 * Payments of an order: what was collected and what is still owed, the records, and (with
 * `order:update`) recording a payment or refund and removing a record entered by mistake.
 */
export function PaymentsSection({
  orderId,
  currency,
  totalMinor,
  cancelled,
  canUpdate,
  payments,
}: {
  orderId: string;
  currency: string;
  totalMinor: number;
  cancelled: boolean;
  canUpdate: boolean;
  payments: PaymentRecord[];
}) {
  const t = useTranslations("Orders.payments");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [recording, setRecording] = useState(false);
  const [removing, setRemoving] = useState<PaymentRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);

  const money = (minor: number) => formatMoney(minor, currency, locale);
  const { refunded, net, due } = paymentTotals(totalMinor, payments);
  const canPay = !cancelled && due > 0;
  const canRefund = net > 0;

  async function remove(payment: PaymentRecord) {
    setBusy(true);
    setError(null);
    const result = await deletePaymentAction(orderId, payment.id).catch(() => null);
    setBusy(false);
    setRemoving(null);
    if (!result?.ok) setError(result && result.error !== "invalid" ? result.error : "failed");
    router.refresh();
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4 text-sm" aria-labelledby="payments-title">
      <h2 id="payments-title" className="font-semibold">
        {t("title")}
      </h2>

      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">{t("collected")}</dt>
        <dd className="text-right tabular-nums">{money(net)}</dd>
        {refunded > 0 && (
          <>
            <dt className="text-muted-foreground">{t("refunded")}</dt>
            <dd className="text-right tabular-nums">{money(refunded)}</dd>
          </>
        )}
        <dt className="font-medium">{t("due")}</dt>
        <dd className="text-right font-medium tabular-nums">{money(cancelled ? 0 : due)}</dd>
      </dl>

      {payments.length === 0 ? (
        <p className="text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="flex flex-col gap-2 border-t pt-3">
          {payments.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                {t(`kind.${p.kind as PaymentKind}`)} · {t(`method.${p.method as PaymentMethod}`)}
                <span className="block text-xs text-muted-foreground">
                  <LocalDateTime iso={p.paidAt} locale={locale} />
                  {p.recordedByName && ` · ${p.recordedByName}`}
                </span>
                {p.note && <span className="block text-xs whitespace-pre-line">{p.note}</span>}
              </span>
              <span className="flex shrink-0 items-center gap-1">
                <span className="tabular-nums">
                  {p.kind === "refund" ? "−" : ""}
                  {money(p.amountMinor)}
                </span>
                {canUpdate && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("remove")}
                    disabled={!hydrated || busy}
                    onClick={() => setRemoving(p)}
                  >
                    <Trash2Icon />
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p role="alert" className="text-destructive">
          {t(`errors.${error}`)}
        </p>
      )}

      {canUpdate && (canPay || canRefund) && (
        <Button variant="outline" className="w-fit" disabled={!hydrated} onClick={() => setRecording(true)}>
          {canPay ? t("record") : t("recordRefund")}
        </Button>
      )}

      <Dialog open={recording} onOpenChange={(open) => !open && setRecording(false)}>
        <DialogContent>
          {recording && (
            <PaymentForm
              orderId={orderId}
              currency={currency}
              dueMinor={canPay ? due : 0}
              netMinor={net}
              onDone={() => {
                setRecording(false);
                setError(null);
                router.refresh();
              }}
              onCancel={() => setRecording(false)}
            />
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={removing !== null} onOpenChange={(open) => !open && !busy && setRemoving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {removing && t(removing.kind === "refund" ? "removeRefundTitle" : "removeTitle", { amount: money(removing.amountMinor) })}
            </DialogTitle>
            <DialogDescription>{t("removeConfirm")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setRemoving(null)}>
              {t("back")}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => removing && remove(removing)}>
              {t("remove")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function PaymentForm({
  orderId,
  currency,
  dueMinor,
  netMinor,
  onDone,
  onCancel,
}: {
  orderId: string;
  currency: string;
  /** 0 when no payment can be recorded (nothing owed, or the order is cancelled) */
  dueMinor: number;
  netMinor: number;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Orders.payments");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const hydrated = useHydrated();
  const [message, setMessage] = useState<ErrorKey | null>(null);
  const digits = currencyDigits(currency);
  const kinds: PaymentKind[] = [...(dueMinor > 0 ? (["payment"] as const) : []), ...(netMinor > 0 ? (["refund"] as const) : [])];
  const suggested = (kind: PaymentKind) => minorToInput(kind === "payment" ? dueMinor : netMinor, digits);

  const schema = useMemo(
    () =>
      createPaymentSchema(tv, currencyDigits(currency), {
        dueMinor,
        netMinor,
        format: (minor) => formatMoney(minor, currency, locale),
      }),
    [tv, dueMinor, netMinor, currency, locale],
  );
  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { kind: kinds[0], method: "cash", amount: suggested(kinds[0]), paidAt: "", note: "" },
  });
  const kind = useWatch({ control: form.control, name: "kind" });

  async function onSubmit(values: PaymentFormValues) {
    setMessage(null);
    const result: PaymentActionResult | null = await recordPaymentAction(
      orderId,
      { ...values, paidAt: localInputToIso(values.paidAt) },
      locale,
    ).catch(() => null);
    if (result?.ok) return onDone();
    if (result?.error === "invalid" && result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        form.setError(field as keyof PaymentFormValues, { message: messages[0] });
      }
    } else {
      setMessage(result && result.error !== "invalid" ? result.error : "failed");
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t(kind === "refund" ? "recordRefund" : "record")}</DialogTitle>
        <DialogDescription>{t("recordHelp")}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        {kinds.length > 1 && (
          <div role="radiogroup" aria-label={t("kindLabel")} className="flex gap-2">
            {kinds.map((option) => (
              <Button
                key={option}
                type="button"
                role="radio"
                aria-checked={kind === option}
                variant={kind === option ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  form.setValue("kind", option);
                  form.setValue("amount", suggested(option), { shouldValidate: form.formState.isSubmitted });
                }}
              >
                {t(`kind.${option}`)}
              </Button>
            ))}
          </div>
        )}
        <Controller
          name="amount"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="payment-amount">{t("amount", { currency })}</FieldLabel>
              <Input {...field} id="payment-amount" inputMode="decimal" autoComplete="off" aria-invalid={fieldState.invalid} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="method"
          control={form.control}
          render={({ field }) => (
            <Field>
              <FieldLabel htmlFor="payment-method">{t("methodLabel")}</FieldLabel>
              <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                <SelectTrigger id="payment-method" className="w-full">
                  <SelectValue>{(value: PaymentMethod) => t(`method.${value}`)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((method) => (
                    <SelectItem key={method} value={method}>
                      {t(`method.${method}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
        />
        <Controller
          name="paidAt"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="payment-date">{t(kind === "refund" ? "refundedAt" : "paidAt")}</FieldLabel>
              <Input {...field} id="payment-date" type="datetime-local" aria-invalid={fieldState.invalid} />
              <FieldDescription>{t("paidAtHelp")}</FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
        <Controller
          name="note"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="payment-note">{t("note")}</FieldLabel>
              <Textarea {...field} id="payment-note" rows={2} aria-invalid={fieldState.invalid} />
              <FieldDescription>{t("noteHelp")}</FieldDescription>
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
        <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={onCancel}>
          {t("back")}
        </Button>
        <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
          {t(kind === "refund" ? "saveRefund" : "save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
