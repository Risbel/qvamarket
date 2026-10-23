"use client";

import { useStoreId } from "@/components/panel-scope";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { currencyDigits, formatMoney, minorToInput } from "@/lib/money";
import { PAYMENT_METHODS, paymentTotals, type PaymentKind, type PaymentMethod } from "@/lib/orders";
import { useHydrated } from "@/lib/use-hydrated";
import { createPaymentSchema, type PaymentFormValues } from "@/lib/validation/payment";
import { deletePaymentAction, recordPaymentAction, type PaymentActionResult } from "@/server/order-actions";
import { DateTimePicker } from "@/components/date-time-picker";
import { useCan } from "@/components/permissions/permissions-provider";
import { LocalDateTime, localInputToIso } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

export type PaymentRecord = {
  id: string;
  kind: string;
  method: string;
  amountMinor: number;
  paidAt: string;
  recordedByName: string | null;
  /** e.g. a transfer's bank reference (counter sales) */
  reference: string | null;
  note: string | null;
};

type ErrorKey = "forbidden" | "notFound" | "cancelled" | "unbalanced" | "closedPeriod" | "failed";

const pad = (n: number) => String(n).padStart(2, "0");

/** Amounts in the order's currency, for the limits in the form's messages. */
function moneyFormatter(currency: string, locale: string) {
  return (minor: number) => formatMoney(minor, currency, locale);
}

/**
 * The amount a new record starts with: all that is still owed (payment), or for a refund
 * what was collected above the total (after an edit lowered it), else all that was collected.
 */
function suggestedAmount(kind: PaymentKind, dueMinor: number, netMinor: number, overpaidMinor: number, digits: number) {
  return minorToInput(kind === "payment" ? dueMinor : overpaidMinor || netMinor, digits);
}

/**
 * Payments of an order: what was collected and what is still owed, the records, and (with
 * `order:update`) recording a payment or refund and removing a record entered by mistake.
 */
export function PaymentsSection({
  orderId,
  currency,
  totalMinor,
  cancelled,
  payments,
  noShift,
}: {
  orderId: string;
  currency: string;
  totalMinor: number;
  cancelled: boolean;
  payments: PaymentRecord[];
  /** the viewer runs a register but has no open shift (cash would go to no drawer) */
  noShift: boolean;
}) {
  const storeId = useStoreId();
  const t = useTranslations("Orders.payments");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [recording, setRecording] = useState(false);
  const [removing, setRemoving] = useState<PaymentRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ErrorKey | null>(null);

  const money = (minor: number) => formatMoney(minor, currency, locale);
  const { refunded, net, due, overpaid } = paymentTotals(totalMinor, payments);
  // a cancelled order owes everything collected back, which "Collected" already shows
  const toRefund = cancelled ? 0 : overpaid;
  const can = useCan();
  const canRecord = can({ payment: ["create"] });
  const canRemove = can({ payment: ["delete"] });
  const canPay = !cancelled && due > 0;
  const canRefund = net > 0;

  async function remove(payment: PaymentRecord) {
    setBusy(true);
    setError(null);
    const result = await deletePaymentAction(storeId, orderId, payment.id).catch(() => null);
    setBusy(false);
    setRemoving(null);
    if (result?.ok) toast.success(t(payment.kind === "refund" ? "toasts.refundRemoved" : "toasts.paymentRemoved"));
    else setError(result && result.error !== "invalid" ? result.error : "failed");
    router.refresh();
  }

  return (
    <Card role="region" aria-labelledby="payments-title">
      <CardHeader>
        <CardTitle>
          <h2 id="payments-title">{t("title")}</h2>
        </CardTitle>
        {canRecord && (canPay || canRefund) && (
          <CardAction>
            <Button size="sm" variant="outline" disabled={!hydrated} onClick={() => setRecording(true)}>
              <PlusIcon />
              {canPay ? t("record") : t("recordRefund")}
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1">
          <dt className="text-muted-foreground">{t("collected")}</dt>
          <dd className="text-right tabular-nums">{money(net)}</dd>
          {refunded > 0 && (
            <>
              <dt className="text-muted-foreground">{t("refunded")}</dt>
              <dd className="text-right tabular-nums">{money(refunded)}</dd>
            </>
          )}
          {toRefund > 0 ? (
            <>
              <dt className="font-medium text-destructive">{t("toRefund")}</dt>
              <dd className="text-right font-medium text-destructive tabular-nums">{money(toRefund)}</dd>
            </>
          ) : (
            <>
              <dt className="font-medium">{t("due")}</dt>
              <dd className="text-right font-medium tabular-nums">{money(cancelled ? 0 : due)}</dd>
            </>
          )}
        </dl>
        {toRefund > 0 && <p className="text-xs text-muted-foreground">{t("toRefundHelp")}</p>}

        <Separator />

        {payments.length === 0 ? (
          <p className="text-muted-foreground">{t("none")}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {payments.map((p) => (
              <li key={p.id} className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium">{t(`method.${p.method as PaymentMethod}`)}</span>
                    <Badge variant={p.kind === "refund" ? "destructive" : "secondary"}>{t(`kind.${p.kind as PaymentKind}`)}</Badge>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    <LocalDateTime iso={p.paidAt} locale={locale} />
                    {p.recordedByName && ` · ${p.recordedByName}`}
                  </span>
                  {p.reference && <span className="text-xs">{t("reference", { reference: p.reference })}</span>}
                  {p.note && <span className="text-xs whitespace-pre-line">{p.note}</span>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <span className="font-medium tabular-nums">
                    {p.kind === "refund" ? "−" : ""}
                    {money(p.amountMinor)}
                  </span>
                  {canRemove && (
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
                </div>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p role="alert" className="text-destructive">
            {t(`errors.${error}`)}
          </p>
        )}
      </CardContent>

      <Dialog open={recording} onOpenChange={(open) => !open && setRecording(false)}>
        <DialogContent>
          {recording && (
            <PaymentForm
              orderId={orderId}
              currency={currency}
              dueMinor={canPay ? due : 0}
              netMinor={net}
              overpaidMinor={toRefund}
              noShift={noShift}
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
    </Card>
  );
}

function PaymentForm({
  orderId,
  currency,
  dueMinor,
  netMinor,
  overpaidMinor,
  noShift,
  onDone,
  onCancel,
}: {
  orderId: string;
  currency: string;
  /** 0 when no payment can be recorded (nothing owed, or the order is cancelled) */
  dueMinor: number;
  netMinor: number;
  /** collected above the total (an edit lowered it): what a refund starts with */
  overpaidMinor: number;
  noShift: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const storeId = useStoreId();
  const t = useTranslations("Orders.payments");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const hydrated = useHydrated();
  const [message, setMessage] = useState<ErrorKey | null>(null);
  // The dialog only opens after a click, so this runs in the browser (its clock and timezone)
  const [now] = useState(() => new Date());
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const digits = currencyDigits(currency);
  const kinds: PaymentKind[] = [...(dueMinor > 0 ? (["payment"] as const) : []), ...(netMinor > 0 ? (["refund"] as const) : [])];

  // Not wrapped in useMemo: the React Compiler lint cannot preserve it here, and useForm reads the
  // resolver again on every render, so a new schema per render is fine (and cheap)
  const schema = createPaymentSchema(tv, digits, { dueMinor, netMinor, format: moneyFormatter(currency, locale) });
  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(schema),
    defaultValues: { kind: kinds[0], method: "cash", amount: suggestedAmount(kinds[0], dueMinor, netMinor, overpaidMinor, digits), paidAt: "", note: "" },
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const refund = kind === "refund";
  const method = useWatch({ control: form.control, name: "method" });

  /** Switching between payment and refund suggests the matching amount (what is due / was collected). */
  function chooseKind(next: PaymentKind) {
    form.setValue("kind", next);
    form.setValue("amount", suggestedAmount(next, dueMinor, netMinor, overpaidMinor, digits), { shouldValidate: form.formState.isSubmitted });
  }

  async function onSubmit(values: PaymentFormValues) {
    setMessage(null);
    const result: PaymentActionResult | null = await recordPaymentAction(storeId, 
      orderId,
      { ...values, paidAt: localInputToIso(values.paidAt) },
      locale,
    ).catch(() => null);
    if (result?.ok) {
      toast.success(t(values.kind === "refund" ? "toasts.refundRecorded" : "toasts.paymentRecorded"));
      return onDone();
    }
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
        <DialogTitle>{t(refund ? "recordRefund" : "record")}</DialogTitle>
        <DialogDescription>{t("recordHelp")}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        {kinds.length > 1 && <KindChoice kinds={kinds} value={kind} onChange={chooseKind} />}
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="amount"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="payment-amount">{t("amount")}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    {...field}
                    id="payment-amount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={t("amountPlaceholder", { example: suggestedAmount(kind, dueMinor, netMinor, overpaidMinor, digits) })}
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
                {noShift && method === "cash" && <FieldDescription>{t("noShift")}</FieldDescription>}
              </Field>
            )}
          />
        </div>
        <Controller
          name="paidAt"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="payment-date">{t(refund ? "refundedAt" : "paidAt")}</FieldLabel>
              <DateTimePicker
                id="payment-date"
                value={field.value}
                onChange={field.onChange}
                defaultTime={`${pad(now.getHours())}:${pad(now.getMinutes())}`}
                maxDate={now}
                locale={locale}
                invalid={fieldState.invalid}
                labels={{
                  placeholder: t("datePlaceholder"),
                  time: t(refund ? "refundTime" : "paidTime"),
                  clear: t("dateClear"),
                }}
              />
              <FieldDescription>
                {t("paidAtHelp")} {t("timeZone", { zone: timeZone })}
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
              <FieldLabel htmlFor="payment-note">{t("note")}</FieldLabel>
              <Textarea
                {...field}
                id="payment-note"
                rows={2}
                placeholder={t(refund ? "refundNotePlaceholder" : "notePlaceholder")}
                aria-invalid={fieldState.invalid}
              />
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
          {t(refund ? "saveRefund" : "save")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Payment or refund, as two choice cards (only offered when both are possible). */
function KindChoice({
  kinds,
  value,
  onChange,
}: {
  kinds: PaymentKind[];
  value: PaymentKind;
  onChange: (kind: PaymentKind) => void;
}) {
  const t = useTranslations("Orders.payments");
  return (
    <FieldSet>
      <FieldLegend variant="label">{t("kindLabel")}</FieldLegend>
      <RadioGroup
        value={value}
        onValueChange={(next) => onChange(next as PaymentKind)}
        className="grid gap-2 sm:grid-cols-2"
      >
        {kinds.map((option) => (
          <FieldLabel key={option} htmlFor={`payment-kind-${option}`}>
            <Field orientation="horizontal">
              <RadioGroupItem value={option} id={`payment-kind-${option}`} />
              <FieldContent>
                <FieldTitle>{t(`kind.${option}`)}</FieldTitle>
                <FieldDescription>{t(`kindHelp.${option}`)}</FieldDescription>
              </FieldContent>
            </Field>
          </FieldLabel>
        ))}
      </RadioGroup>
    </FieldSet>
  );
}
