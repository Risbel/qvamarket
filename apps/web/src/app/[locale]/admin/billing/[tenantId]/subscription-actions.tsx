"use client";

import { useState } from "react";
import { Controller, useForm, useWatch, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDownIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import {
  BILLING_CYCLES,
  DEFAULT_DUE_DAYS,
  MAX_PAUSE_DAYS,
  planChangeOutcome,
  prorate,
  type BillingCycle,
  type PlanChangeOutcome,
  type SubscriptionStatus,
} from "@/lib/billing";
import { formatMoney } from "@/lib/money";
import { FALLBACK_PLAN, PLAN_KEYS, type PlanKey } from "@/lib/plans";
import { useHydrated } from "@/lib/use-hydrated";
import {
  createAdjustDateSchema,
  createChangePlanSchema,
  createManualInvoiceSchema,
  createNoteSchema,
  createPauseSchema,
  type ChangePlanValues,
} from "@/lib/validation/billing";
import { currencyDigits } from "@/lib/money";
import {
  cancelScheduledChangeAction,
  cancelSubscriptionAction,
  changePlanAction,
  issueManualInvoiceAction,
  issueNextInvoiceAction,
  pauseSubscriptionAction,
  reactivateSubscriptionAction,
  resumeSubscriptionAction,
  setPaidUntilAction,
  setTrialEndAction,
  type BillingActionResult,
} from "@/server/billing-actions";
import { DateTimePicker } from "@/components/date-time-picker";
import { localInputToIso } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

/** What the page knows about the subscription (dates as ISO strings). */
export type SubscriptionView = {
  tenantId: string;
  /** the chosen plan */
  planKey: PlanKey;
  /** the plan that applies right now */
  effectivePlan: PlanKey;
  status: SubscriptionStatus;
  storedStatus: string;
  cycle: BillingCycle;
  currencyCode: string;
  periodStart: string | null;
  paidUntil: string | null;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  pausedAt: string | null;
  pauseResumesAt: string | null;
  cancelAtPeriodEnd: boolean;
  scheduledPlanKey: PlanKey | null;
  scheduledCycle: BillingCycle | null;
};

export type PriceView = { planKey: string; cycle: string; currencyCode: string; amountMinor: number };

type DialogKey =
  | "plan"
  | "invoice"
  | "pause"
  | "resume"
  | "cancelAtEnd"
  | "cancelNow"
  | "reactivate"
  | "unschedule"
  | "paidUntil"
  | "trialEnd";

const pad = (n: number) => String(n).padStart(2, "0");
const nowTime = (date: Date) => `${pad(date.getHours())}:${pad(date.getMinutes())}`;

/** The subscription's actions: change plan, invoices, pause / resume, cancel / reactivate, corrections. */
export function SubscriptionActions({ subscription, prices }: { subscription: SubscriptionView; prices: PriceView[] }) {
  const t = useTranslations("Billing.actions");
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState<DialogKey | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const s = subscription;
  const paused = s.storedStatus === "paused";
  const paidPlan = s.effectivePlan !== FALLBACK_PLAN;
  const nextPlan = s.scheduledPlanKey ?? s.planKey;
  const canIssueNext = Boolean(s.paidUntil) && !paused && s.storedStatus !== "cancelled" && !s.cancelAtPeriodEnd && nextPlan !== FALLBACK_PLAN;
  const canPause = !paused && s.status !== "expired" && s.status !== "cancelled";
  const canCancelAtEnd =
    paidPlan && (s.status === "active" || s.status === "past_due") && Boolean(s.paidUntil) && !s.cancelAtPeriodEnd;
  const canCancelNow = paidPlan && s.status !== "cancelled";
  const canFixPaidUntil = s.planKey !== FALLBACK_PLAN && s.storedStatus !== "cancelled" && s.storedStatus !== "trialing";

  async function issueNext() {
    setBusy(true);
    setError(null);
    const result = await issueNextInvoiceAction(s.tenantId).catch(() => null);
    setBusy(false);
    if (result?.ok) {
      toast.success(t("toasts.invoiceIssued"));
      router.refresh();
    } else {
      setError(t(`errors.${errorKey(result)}`));
    }
  }

  const done = (message: string) => {
    toast.success(message);
    setOpen(null);
    setError(null);
    router.refresh();
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button disabled={!hydrated} onClick={() => setOpen("plan")}>
          {t("changePlan")}
        </Button>
        {canIssueNext && (
          <Button variant="outline" disabled={!hydrated || busy} onClick={issueNext}>
            {t("issueNext")}
          </Button>
        )}
        {paused ? (
          <Button variant="outline" disabled={!hydrated} onClick={() => setOpen("resume")}>
            {t("resume")}
          </Button>
        ) : (
          canPause && (
            <Button variant="outline" disabled={!hydrated} onClick={() => setOpen("pause")}>
              {t("pause")}
            </Button>
          )
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" disabled={!hydrated} />}>
            {t("more")}
            <ChevronDownIcon />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setOpen("invoice")}>{t("manualInvoice")}</DropdownMenuItem>
            {canFixPaidUntil && <DropdownMenuItem onClick={() => setOpen("paidUntil")}>{t("paidUntil")}</DropdownMenuItem>}
            {s.storedStatus === "trialing" && <DropdownMenuItem onClick={() => setOpen("trialEnd")}>{t("trialEnd")}</DropdownMenuItem>}
            {(s.scheduledPlanKey || s.scheduledCycle) && (
              <DropdownMenuItem onClick={() => setOpen("unschedule")}>{t("unschedule")}</DropdownMenuItem>
            )}
            {(canCancelAtEnd || canCancelNow || s.cancelAtPeriodEnd) && <DropdownMenuSeparator />}
            {s.cancelAtPeriodEnd && <DropdownMenuItem onClick={() => setOpen("reactivate")}>{t("reactivate")}</DropdownMenuItem>}
            {canCancelAtEnd && <DropdownMenuItem onClick={() => setOpen("cancelAtEnd")}>{t("cancelAtEnd")}</DropdownMenuItem>}
            {canCancelNow && (
              <DropdownMenuItem variant="destructive" onClick={() => setOpen("cancelNow")}>
                {t("cancelNow")}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="sm:max-w-lg">
          {open === "plan" && (
            <ChangePlanForm subscription={s} prices={prices} onDone={() => done(t("toasts.planChanged"))} onCancel={() => setOpen(null)} />
          )}
          {open === "invoice" && (
            <ManualInvoiceForm subscription={s} onDone={() => done(t("toasts.invoiceIssued"))} onCancel={() => setOpen(null)} />
          )}
          {open === "pause" && <PauseForm subscription={s} onDone={() => done(t("toasts.paused"))} onCancel={() => setOpen(null)} />}
          {(open === "paidUntil" || open === "trialEnd") && (
            <AdjustDateForm
              kind={open}
              subscription={s}
              onDone={() => done(t(open === "paidUntil" ? "toasts.paidUntil" : "toasts.trialEnd"))}
              onCancel={() => setOpen(null)}
            />
          )}
          {(open === "resume" || open === "cancelAtEnd" || open === "cancelNow" || open === "reactivate" || open === "unschedule") && (
            <NoteForm
              kind={open}
              subscription={s}
              onDone={() => done(t(`toasts.${open}`))}
              onCancel={() => setOpen(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function errorKey(result: BillingActionResult | null) {
  return result && !result.ok ? result.error : "failed";
}

/** Puts a failed action's field errors on the form; returns the message for anything else. */
function useResultHandler<T extends FieldValues>(form: UseFormReturn<T>) {
  const t = useTranslations("Billing.actions");
  return (result: BillingActionResult | null): string | null => {
    if (result?.ok) return null;
    if (result?.error === "invalid" && result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) form.setError(field as Path<T>, { message: messages[0] });
      return null;
    }
    return t(`errors.${errorKey(result)}`);
  };
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  );
}

function NoteField<T extends FieldValues>({ form, name, label, placeholder, required }: {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  placeholder: string;
  required?: boolean;
}) {
  const t = useTranslations("Billing.actions");
  return (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`billing-${name}`}>{label}</FieldLabel>
          <Textarea {...field} id={`billing-${name}`} rows={2} placeholder={placeholder} aria-invalid={fieldState.invalid} />
          <FieldDescription>{required ? t("noteRequiredHelp") : t("noteHelp")}</FieldDescription>
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

function DateField<T extends FieldValues>({ form, name, label, description, maxDate }: {
  form: UseFormReturn<T>;
  name: Path<T>;
  label: string;
  description: string;
  maxDate?: Date;
}) {
  const t = useTranslations("Billing.actions");
  const locale = useLocale();
  const [now] = useState(() => new Date());
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  return (
    <Controller
      name={name}
      control={form.control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={`billing-${name}`}>{label}</FieldLabel>
          <DateTimePicker
            id={`billing-${name}`}
            value={field.value}
            onChange={field.onChange}
            defaultTime={nowTime(now)}
            maxDate={maxDate}
            locale={locale}
            invalid={fieldState.invalid}
            labels={{ placeholder: t("datePlaceholder"), time: t("time"), clear: t("dateClear") }}
          />
          <FieldDescription>
            {description} {t("timeZone", { zone: timeZone })}
          </FieldDescription>
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}

function Footer({ submitting, label, onCancel, destructive }: { submitting: boolean; label: string; onCancel: () => void; destructive?: boolean }) {
  const t = useTranslations("Billing.actions");
  const hydrated = useHydrated();
  return (
    <DialogFooter>
      <Button type="button" variant="outline" disabled={submitting} onClick={onCancel}>
        {t("back")}
      </Button>
      <Button type="submit" variant={destructive ? "destructive" : "default"} disabled={!hydrated || submitting}>
        {label}
      </Button>
    </DialogFooter>
  );
}

// ---- change plan

function ChangePlanForm({
  subscription: s,
  prices,
  onDone,
  onCancel,
}: {
  subscription: SubscriptionView;
  prices: PriceView[];
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations("Billing.changePlan");
  const tp = useTranslations("Plans.plans");
  const tc = useTranslations("Billing.cycles");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const [now] = useState(() => new Date());
  const [message, setMessage] = useState<string | null>(null);

  const schema = createChangePlanSchema(tv);
  const form = useForm<ChangePlanValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      planKey: s.planKey,
      cycle: s.cycle,
      currencyCode: s.currencyCode,
      timing: "periodEnd",
      startsAt: "",
      dueDays: DEFAULT_DUE_DAYS,
      note: "",
    },
  });
  const handle = useResultHandler(form);
  const [planKey, cycle, currencyCode, timing] = useWatch({ control: form.control, name: ["planKey", "cycle", "currencyCode", "timing"] });

  const priceOf = (plan: string, c: string, code: string) =>
    prices.find((p) => p.planKey === plan && p.cycle === c && p.currencyCode === code)?.amountMinor ?? null;
  const currencies = [...new Set(prices.filter((p) => p.planKey === planKey && p.cycle === cycle).map((p) => p.currencyCode))];
  const free = planKey === FALLBACK_PLAN;
  const price = free ? 0 : priceOf(planKey, cycle, currencyCode);

  const current = {
    plan: s.effectivePlan,
    chosenPlan: s.planKey,
    status: s.status,
    cycle: s.cycle,
    currencyCode: s.currencyCode,
    paidUntil: s.paidUntil ? new Date(s.paidUntil) : null,
  };
  const outcomeOf = (when: "now" | "periodEnd") => planChangeOutcome(current, { planKey, cycle, currencyCode, timing: when }, now);
  const outcome = outcomeOf(timing);
  // The choice "at the end of the period / now" only shows when it changes something
  const timingMatters = outcomeOf("now") !== outcomeOf("periodEnd");
  const prorated =
    outcome === "prorated" && price !== null && s.paidUntil
      ? prorate(priceOf(s.effectivePlan, s.cycle, s.currencyCode) ?? 0, price, { start: new Date(s.periodStart ?? now), end: new Date(s.paidUntil) }, now)
      : null;

  /** A plan or cycle without a price in the chosen currency switches to one that has it. */
  function pickTerms(next: { planKey?: PlanKey; cycle?: BillingCycle }) {
    const p = next.planKey ?? planKey;
    const c = next.cycle ?? cycle;
    if (next.planKey) form.setValue("planKey", p);
    if (next.cycle) form.setValue("cycle", c);
    const available = prices.filter((x) => x.planKey === p && x.cycle === c).map((x) => x.currencyCode);
    if (available.length > 0 && !available.includes(form.getValues("currencyCode"))) form.setValue("currencyCode", available[0]);
  }

  async function onSubmit(values: ChangePlanValues) {
    setMessage(null);
    const result = await changePlanAction(s.tenantId, { ...values, startsAt: values.startsAt ? localInputToIso(values.startsAt) : "" }, locale).catch(
      () => null,
    );
    if (result?.ok) return onDone();
    setMessage(handle(result));
  }

  const money = (minor: number) => formatMoney(minor, currencyCode, locale);
  const paidUntil = s.paidUntil ? new Date(s.paidUntil).toLocaleDateString(locale) : "";

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="planKey"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="plan-key">{t("plan")}</FieldLabel>
                <Select value={field.value} onValueChange={(value) => value && pickTerms({ planKey: value as PlanKey })}>
                  <SelectTrigger id="plan-key" className="w-full">
                    <SelectValue>{(value: PlanKey) => tp(`${value}.name`)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PLAN_KEYS.map((key) => (
                      <SelectItem key={key} value={key}>
                        {tp(`${key}.name`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
          {!free && (
            <Controller
              name="cycle"
              control={form.control}
              render={({ field }) => (
                <Field>
                  <FieldLabel htmlFor="plan-cycle">{t("cycle")}</FieldLabel>
                  <Select value={field.value} onValueChange={(value) => value && pickTerms({ cycle: value as BillingCycle })}>
                    <SelectTrigger id="plan-cycle" className="w-full">
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
          )}
        </div>
        {!free && (
          <Controller
            name="currencyCode"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="plan-currency">{t("currency")}</FieldLabel>
                {currencies.length === 0 ? (
                  <p className="text-sm text-destructive">{t("noPrice")}</p>
                ) : (
                  <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                    <SelectTrigger id="plan-currency" className="w-full">
                      <SelectValue>
                        {(value: string) => {
                          const amount = priceOf(planKey, cycle, value);
                          return amount === null ? value : `${value} · ${formatMoney(amount, value, locale)}`;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {currencies.map((code) => (
                        <SelectItem key={code} value={code}>
                          {code} · {formatMoney(priceOf(planKey, cycle, code) ?? 0, code, locale)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </Field>
            )}
          />
        )}

        {timingMatters && (
          <Controller
            name="timing"
            control={form.control}
            render={({ field }) => (
              <FieldSet>
                <FieldLegend variant="label">{t("when")}</FieldLegend>
                <RadioGroup value={field.value} onValueChange={(value) => field.onChange(value)} className="grid gap-2 sm:grid-cols-2">
                  {(["periodEnd", "now"] as const).map((option) => (
                    <FieldLabel key={option} htmlFor={`plan-timing-${option}`}>
                      <Field orientation="horizontal">
                        <RadioGroupItem value={option} id={`plan-timing-${option}`} />
                        <FieldContent>
                          <FieldTitle>{t(`timing.${option}`, { date: paidUntil })}</FieldTitle>
                          <FieldDescription>{t(`timingHelp.${option}`)}</FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldLabel>
                  ))}
                </RadioGroup>
              </FieldSet>
            )}
          />
        )}

        {outcome === "newPeriod" && (
          <DateField form={form} name="startsAt" label={t("startsAt")} description={t("startsAtHelp")} />
        )}
        {(outcome === "newPeriod" || outcome === "prorated") && (
          <Controller
            name="dueDays"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="plan-due-days">{t("dueDays")}</FieldLabel>
                <InputGroup className="max-w-40">
                  <InputGroupInput
                    id="plan-due-days"
                    inputMode="numeric"
                    value={Number.isNaN(field.value) ? "" : String(field.value)}
                    onChange={(event) => field.onChange(event.target.value === "" ? Number.NaN : Number(event.target.value))}
                    placeholder={String(DEFAULT_DUE_DAYS)}
                    aria-invalid={fieldState.invalid}
                  />
                  <InputGroupAddon align="inline-end">
                    <InputGroupText>{t("days")}</InputGroupText>
                  </InputGroupAddon>
                </InputGroup>
                <FieldDescription>{t("dueDaysHelp")}</FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        )}

        <Outcome outcome={outcome} amount={outcome === "prorated" ? (prorated ?? 0) : (price ?? 0)} money={money} paidUntil={paidUntil} />

        <NoteField form={form} name="note" label={t("note")} placeholder={t("notePlaceholder")} />
      </FieldGroup>
      <FormError message={message} />
      <Footer
        submitting={form.formState.isSubmitting}
        label={t("submit")}
        onCancel={onCancel}
      />
    </form>
  );
}

/** What will happen, in one sentence (the same rule the server applies). */
function Outcome({ outcome, amount, money, paidUntil }: { outcome: PlanChangeOutcome; amount: number; money: (minor: number) => string; paidUntil: string }) {
  const t = useTranslations("Billing.changePlan.outcome");
  return (
    <p className="rounded-md border bg-muted/50 p-3 text-sm" aria-live="polite">
      {t(outcome, { amount: money(amount), date: paidUntil })}
    </p>
  );
}

// ---- manual invoice

function ManualInvoiceForm({ subscription: s, onDone, onCancel }: { subscription: SubscriptionView; onDone: () => void; onCancel: () => void }) {
  const t = useTranslations("Billing.manualInvoice");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const [message, setMessage] = useState<string | null>(null);
  const [digits, setDigits] = useState(() => currencyDigits(s.currencyCode));
  const form = useForm({
    resolver: zodResolver(createManualInvoiceSchema(tv, digits)),
    defaultValues: { currencyCode: s.currencyCode, amount: "", dueAt: "", note: "" },
  });
  const handle = useResultHandler(form);

  async function onSubmit(values: { currencyCode: string; amount: string; dueAt: string; note: string }) {
    setMessage(null);
    const result = await issueManualInvoiceAction(s.tenantId, { ...values, dueAt: values.dueAt ? localInputToIso(values.dueAt) : "" }, locale).catch(
      () => null,
    );
    if (result?.ok) return onDone();
    setMessage(handle(result));
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <Controller
            name="amount"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="invoice-amount">{t("amount")}</FieldLabel>
                <Input {...field} id="invoice-amount" inputMode="decimal" autoComplete="off" placeholder={t("amountPlaceholder")} aria-invalid={fieldState.invalid} />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            name="currencyCode"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="invoice-currency">{t("currency")}</FieldLabel>
                <Input
                  {...field}
                  id="invoice-currency"
                  maxLength={3}
                  autoComplete="off"
                  placeholder="USD"
                  onChange={(event) => {
                    const code = event.target.value.toUpperCase();
                    field.onChange(code);
                    if (/^[A-Z]{3}$/.test(code)) {
                      try {
                        setDigits(currencyDigits(code));
                      } catch {
                        // not a currency the browser knows: the server answers
                      }
                    }
                  }}
                  aria-invalid={fieldState.invalid}
                />
              </Field>
            )}
          />
        </div>
        <DateField form={form} name="dueAt" label={t("dueAt")} description={t("dueAtHelp")} />
        <NoteField form={form} name="note" label={t("concept")} placeholder={t("conceptPlaceholder")} required />
      </FieldGroup>
      <FormError message={message} />
      <Footer submitting={form.formState.isSubmitting} label={t("submit")} onCancel={onCancel} />
    </form>
  );
}

// ---- pause

function PauseForm({ subscription: s, onDone, onCancel }: { subscription: SubscriptionView; onDone: () => void; onCancel: () => void }) {
  const t = useTranslations("Billing.pause");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const [message, setMessage] = useState<string | null>(null);
  const [maxDate] = useState(() => new Date(Date.now() + MAX_PAUSE_DAYS * 86_400_000));
  const form = useForm({ resolver: zodResolver(createPauseSchema(tv)), defaultValues: { resumesAt: "", note: "" } });
  const handle = useResultHandler(form);

  async function onSubmit(values: { resumesAt: string; note: string }) {
    setMessage(null);
    const result = await pauseSubscriptionAction(s.tenantId, { ...values, resumesAt: values.resumesAt ? localInputToIso(values.resumesAt) : "" }, locale).catch(
      () => null,
    );
    if (result?.ok) return onDone();
    setMessage(handle(result));
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description", { days: MAX_PAUSE_DAYS })}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <DateField form={form} name="resumesAt" label={t("resumesAt")} description={t("resumesAtHelp")} maxDate={maxDate} />
        <NoteField form={form} name="note" label={t("note")} placeholder={t("notePlaceholder")} />
      </FieldGroup>
      <FormError message={message} />
      <Footer submitting={form.formState.isSubmitting} label={t("submit")} onCancel={onCancel} />
    </form>
  );
}

// ---- corrections of paid-until / trial end

function AdjustDateForm({
  kind,
  subscription: s,
  onDone,
  onCancel,
}: {
  kind: "paidUntil" | "trialEnd";
  subscription: SubscriptionView;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations(`Billing.${kind}`);
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const [message, setMessage] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(createAdjustDateSchema(tv)), defaultValues: { date: "", note: "" } });
  const handle = useResultHandler(form);

  async function onSubmit(values: { date: string; note: string }) {
    setMessage(null);
    const action = kind === "paidUntil" ? setPaidUntilAction : setTrialEndAction;
    const result = await action(s.tenantId, { ...values, date: localInputToIso(values.date) }, locale).catch(() => null);
    if (result?.ok) return onDone();
    setMessage(handle(result));
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <DateField form={form} name="date" label={t("date")} description={t("dateHelp")} />
        <NoteField form={form} name="note" label={t("note")} placeholder={t("notePlaceholder")} required />
      </FieldGroup>
      <FormError message={message} />
      <Footer submitting={form.formState.isSubmitting} label={t("submit")} onCancel={onCancel} />
    </form>
  );
}

// ---- confirmations with an optional note

const NOTE_ACTIONS = {
  resume: (id: string, values: { note: string }, locale: string) => resumeSubscriptionAction(id, values, locale),
  cancelAtEnd: (id: string, values: { note: string }, locale: string) => cancelSubscriptionAction(id, true, values, locale),
  cancelNow: (id: string, values: { note: string }, locale: string) => cancelSubscriptionAction(id, false, values, locale),
  reactivate: (id: string, values: { note: string }, locale: string) => reactivateSubscriptionAction(id, values, locale),
  unschedule: (id: string, values: { note: string }, locale: string) => cancelScheduledChangeAction(id, values, locale),
};

function NoteForm({
  kind,
  subscription: s,
  onDone,
  onCancel,
}: {
  kind: keyof typeof NOTE_ACTIONS;
  subscription: SubscriptionView;
  onDone: () => void;
  onCancel: () => void;
}) {
  const t = useTranslations(`Billing.confirm.${kind}`);
  const ta = useTranslations("Billing.actions");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const [message, setMessage] = useState<string | null>(null);
  const form = useForm({ resolver: zodResolver(createNoteSchema(tv)), defaultValues: { note: "" } });
  const handle = useResultHandler(form);
  const date = s.paidUntil ? new Date(s.paidUntil).toLocaleDateString(locale) : "";

  async function onSubmit(values: { note: string }) {
    setMessage(null);
    const result = await NOTE_ACTIONS[kind](s.tenantId, values, locale).catch(() => null);
    if (result?.ok) return onDone();
    setMessage(handle(result));
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>{t("description", { date })}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <NoteField form={form} name="note" label={ta("note")} placeholder={ta("notePlaceholder")} />
      </FieldGroup>
      <FormError message={message} />
      <Footer submitting={form.formState.isSubmitting} label={t("submit")} onCancel={onCancel} destructive={kind === "cancelNow"} />
    </form>
  );
}
