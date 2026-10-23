"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckIcon, MinusIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useOrgId } from "@/components/panel-scope";
import { useRouter } from "@/i18n/navigation";
import { BILLING_CYCLES, planChangeOutcome, type BillingCycle, type BillingRequestKind, type SubscriptionStatus } from "@/lib/billing";
import { formatMoney } from "@/lib/money";
import { FALLBACK_PLAN, PLANS, PLAN_FEATURES, PLAN_KEYS, planHas, type PlanKey, type PlanLimit } from "@/lib/plans";
import { useHydrated } from "@/lib/use-hydrated";
import { createBillingRequestSchema, type BillingRequestValues } from "@/lib/validation/billing";
import {
  cancelAtPeriodEndAction,
  requestBillingChangeAction,
  scheduleDowngradeAction,
  withdrawCancellationAction,
  withdrawRequestAction,
  withdrawScheduledChangeAction,
  type CompanyBillingResult,
} from "@/server/company-billing-actions";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type OwnerSubscriptionView = {
  planKey: PlanKey;
  effectivePlan: PlanKey;
  status: SubscriptionStatus;
  cycle: BillingCycle;
  currencyCode: string;
  paidUntil: string | null;
  cancelAtPeriodEnd: boolean;
  scheduledPlanKey: PlanKey | null;
  scheduledCycle: BillingCycle | null;
};

type Price = { planKey: string; cycle: string; currencyCode: string; amountMinor: number };
type Request = { kind: BillingRequestKind; planKey: PlanKey | null; cycle: BillingCycle | null; message: string | null; createdAt: string };

const LIMIT_ROWS: PlanLimit[] = ["stores", "activeProducts", "imagesPerProduct", "currencies", "bannerImages", "pages", "members"];

/**
 * The owner's choices: compare plans and move to one (a downgrade at the end of the paid
 * period happens by itself; anything that costs money is a request to the platform), ask for
 * a pause, cancel at the end of the period, and withdraw any of these.
 */
export function BillingControls({
  subscription: s,
  prices,
  request,
  whatsapp,
  companyName,
}: {
  subscription: OwnerSubscriptionView;
  prices: Price[];
  request: Request | null;
  whatsapp: string | null;
  companyName: string;
}) {
  const orgId = useOrgId();
  const t = useTranslations("CompanyBilling");
  const tp = useTranslations("Plans.plans");
  const tc = useTranslations("Billing.cycles");
  const tf = useTranslations("CompanyBilling.features");
  const tl = useTranslations("CompanyBilling.usage.limits");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [cycle, setCycle] = useState<BillingCycle>(s.cycle);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requesting, setRequesting] = useState<{ kind: BillingRequestKind; planKey: PlanKey | null } | null>(null);
  const [downgrading, setDowngrading] = useState<PlanKey | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [now] = useState(() => new Date());

  const paidUntil = s.paidUntil ? new Date(s.paidUntil) : null;
  const paidUntilText = paidUntil ? paidUntil.toLocaleDateString(locale) : "";
  const current = { plan: s.effectivePlan, chosenPlan: s.planKey, status: s.status, cycle: s.cycle, currencyCode: s.currencyCode, paidUntil };
  const priceOf = (plan: PlanKey) => {
    const own = prices.find((p) => p.planKey === plan && p.cycle === cycle && p.currencyCode === s.currencyCode);
    return own ?? prices.find((p) => p.planKey === plan && p.cycle === cycle);
  };
  const paidAndRunning = s.effectivePlan !== FALLBACK_PLAN && (s.status === "active" || s.status === "past_due") && paidUntil !== null && paidUntil > now;

  /** What the button of a plan does: nothing (current), schedule it (free for the owner), or ask for it. */
  function choiceOf(plan: PlanKey): "current" | "schedule" | "request" {
    const outcome = planChangeOutcome(current, { planKey: plan, cycle, currencyCode: s.currencyCode, timing: "periodEnd" }, now);
    if (outcome === "noChange" || (plan === s.effectivePlan && plan === FALLBACK_PLAN)) return "current";
    if (outcome === "atPeriodEnd" || outcome === "freeAtPeriodEnd") return "schedule";
    return "request";
  }

  async function run(action: () => Promise<CompanyBillingResult>, success: string) {
    setBusy(true);
    setError(null);
    const result = await action().catch(() => null);
    setBusy(false);
    if (result?.ok) {
      toast.success(success);
      setDowngrading(null);
      setCancelling(false);
      router.refresh();
      return true;
    }
    setError(t(`errors.${result && !result.ok ? result.error : "failed"}`));
    return false;
  }

  const waText = encodeURIComponent(t("whatsappText", { company: companyName }));

  return (
    <div className="flex flex-col gap-6">
      {request && (
        <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm" role="status">
          <p className="font-medium">
            {request.kind === "plan" && request.planKey
              ? t("request.pendingPlan", { plan: tp(`${request.planKey}.name`), cycle: request.cycle ? tc(request.cycle) : "" })
              : t(`request.pending.${request.kind}`)}
          </p>
          <p className="text-muted-foreground">
            {t("request.sent")} <LocalDateTime iso={request.createdAt} locale={locale} />. {t("request.next")}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            disabled={!hydrated || busy}
            onClick={() => run(() => withdrawRequestAction(orgId), t("toasts.requestWithdrawn"))}
          >
            {t("request.withdraw")}
          </Button>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(s.scheduledPlanKey || s.scheduledCycle) && (
          <Button variant="outline" disabled={!hydrated || busy} onClick={() => run(() => withdrawScheduledChangeAction(orgId), t("toasts.unscheduled"))}>
            {t("actions.unschedule")}
          </Button>
        )}
        {s.cancelAtPeriodEnd ? (
          <Button variant="outline" disabled={!hydrated || busy} onClick={() => run(() => withdrawCancellationAction(orgId), t("toasts.reactivated"))}>
            {t("actions.reactivate")}
          </Button>
        ) : (
          paidAndRunning && (
            <Button variant="outline" disabled={!hydrated || busy} onClick={() => setCancelling(true)}>
              {t("actions.cancel")}
            </Button>
          )
        )}
        {s.status !== "paused" && s.effectivePlan !== FALLBACK_PLAN && (
          <Button variant="outline" disabled={!hydrated} onClick={() => setRequesting({ kind: "pause", planKey: null })}>
            {t("actions.requestPause")}
          </Button>
        )}
        <Button variant="ghost" disabled={!hydrated} onClick={() => setRequesting({ kind: "other", planKey: null })}>
          {t("actions.other")}
        </Button>
        {whatsapp && (
          <a
            href={`https://wa.me/${whatsapp.slice(1)}?text=${waText}`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: "ghost" })}
          >
            {t("actions.whatsapp")}
          </a>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <section aria-labelledby="plans-title" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="plans-title" className="font-semibold">
            {t("plans")}
          </h3>
          <ButtonGroup aria-label={t("cycle")}>
            {BILLING_CYCLES.map((key) => (
              <Button key={key} size="sm" variant={key === cycle ? "default" : "outline"} aria-pressed={key === cycle} onClick={() => setCycle(key)}>
                {tc(key)}
              </Button>
            ))}
          </ButtonGroup>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PLAN_KEYS.map((plan) => {
            const price = plan === FALLBACK_PLAN ? null : priceOf(plan);
            const choice = choiceOf(plan);
            const isCurrent = plan === s.effectivePlan;
            return (
              <div key={plan} className={cn("flex flex-col gap-3 rounded-lg border p-4", isCurrent && "border-primary ring-1 ring-primary")}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{tp(`${plan}.name`)}</span>
                  {isCurrent && <Badge>{t("yourPlan")}</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{tp(`${plan}.description`)}</p>
                <p className="text-xl font-semibold tabular-nums">
                  {plan === FALLBACK_PLAN
                    ? t("free")
                    : price
                      ? `${formatMoney(price.amountMinor, price.currencyCode, locale)} ${t(`per.${cycle}`)}`
                      : t("ask")}
                </p>
                <ul className="flex flex-col gap-1 text-sm">
                  {LIMIT_ROWS.map((limit) => {
                    const max = PLANS[plan].limits[limit];
                    return (
                      <li key={limit} className="flex justify-between gap-2">
                        <span className="text-muted-foreground">{tl(limit)}</span>
                        <span className="tabular-nums">{max === null ? t("unlimited") : max}</span>
                      </li>
                    );
                  })}
                </ul>
                <ul className="flex flex-col gap-1 text-sm">
                  {PLAN_FEATURES.map((feature) => {
                    const has = planHas(plan, feature);
                    return (
                      <li key={feature} className={cn("flex items-center gap-1.5", !has && "text-muted-foreground")}>
                        {has ? <CheckIcon className="size-4 text-primary" aria-hidden /> : <MinusIcon className="size-4" aria-hidden />}
                        <span className={cn(!has && "line-through")}>{tf(feature)}</span>
                        <span className="sr-only">{has ? t("included") : t("notIncluded")}</span>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-auto">
                  {choice === "current" ? null : choice === "schedule" ? (
                    <Button variant="outline" className="w-full" disabled={!hydrated || busy} onClick={() => setDowngrading(plan)}>
                      {t("actions.switchAtEnd", { date: paidUntilText })}
                    </Button>
                  ) : (
                    <Button className="w-full" disabled={!hydrated} onClick={() => setRequesting({ kind: "plan", planKey: plan })}>
                      {t("actions.requestPlan")}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <p className="text-sm text-muted-foreground">{t("howToPay")}</p>
      </section>

      <Dialog open={downgrading !== null} onOpenChange={(open) => !open && !busy && setDowngrading(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{downgrading && t("downgrade.title", { plan: tp(`${downgrading}.name`) })}</DialogTitle>
            <DialogDescription>{t("downgrade.description", { date: paidUntilText })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setDowngrading(null)}>
              {t("back")}
            </Button>
            <Button
              disabled={busy}
              onClick={() =>
                downgrading &&
                run(() => scheduleDowngradeAction(orgId, { planKey: downgrading, cycle, currencyCode: s.currencyCode }), t("toasts.scheduled"))
              }
            >
              {t("downgrade.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={cancelling} onOpenChange={(open) => !open && !busy && setCancelling(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("cancel.title")}</DialogTitle>
            <DialogDescription>{t("cancel.description", { date: paidUntilText })}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setCancelling(false)}>
              {t("back")}
            </Button>
            <Button variant="destructive" disabled={busy} onClick={() => run(() => cancelAtPeriodEndAction(orgId), t("toasts.cancelled"))}>
              {t("cancel.submit")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={requesting !== null} onOpenChange={(open) => !open && setRequesting(null)}>
        <DialogContent>
          {requesting && (
            <RequestForm
              kind={requesting.kind}
              planKey={requesting.planKey}
              cycle={cycle}
              replaces={request !== null}
              onDone={() => {
                setRequesting(null);
                toast.success(t("toasts.requested"));
                router.refresh();
              }}
              onCancel={() => setRequesting(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RequestForm({
  kind,
  planKey,
  cycle,
  replaces,
  onDone,
  onCancel,
}: {
  kind: BillingRequestKind;
  planKey: PlanKey | null;
  cycle: BillingCycle;
  replaces: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const orgId = useOrgId();
  const t = useTranslations("CompanyBilling.request");
  const tc = useTranslations("Billing.cycles");
  const tp = useTranslations("Plans.plans");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const hydrated = useHydrated();
  const [message, setMessage] = useState<string | null>(null);
  const form = useForm<BillingRequestValues>({
    resolver: zodResolver(createBillingRequestSchema(tv)),
    defaultValues: { kind, planKey, cycle: kind === "plan" ? cycle : null, message: "" },
  });
  const chosenCycle = useWatch({ control: form.control, name: "cycle" });

  async function onSubmit(values: BillingRequestValues) {
    setMessage(null);
    const result = await requestBillingChangeAction(orgId, values, locale).catch(() => null);
    if (result?.ok) return onDone();
    if (result?.error === "invalid" && result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) form.setError(field as keyof BillingRequestValues, { message: messages[0] });
      return;
    }
    setMessage(t("failed"));
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{kind === "plan" && planKey ? t("titlePlan", { plan: tp(`${planKey}.name`) }) : t(`title.${kind}`)}</DialogTitle>
        <DialogDescription>
          {t("description")} {replaces && t("replaces")}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        {kind === "plan" && (
          <Controller
            name="cycle"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="request-cycle">{t("cycle")}</FieldLabel>
                <Select value={field.value ?? chosenCycle} onValueChange={(value) => value && field.onChange(value)}>
                  <SelectTrigger id="request-cycle" className="w-full">
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
        <Controller
          name="message"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="request-message">{t(kind === "plan" ? "messageOptional" : "message")}</FieldLabel>
              <Textarea {...field} id="request-message" rows={3} placeholder={t(`placeholder.${kind}`)} aria-invalid={fieldState.invalid} />
              <FieldDescription>{t("messageHelp")}</FieldDescription>
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
          {t("back")}
        </Button>
        <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
          {t("submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
