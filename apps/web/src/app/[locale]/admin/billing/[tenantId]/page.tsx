import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { STATUS_BADGE, formatInvoiceNumber, type SubscriptionEventType } from "@/lib/billing";
import { isPlanKey } from "@/lib/plans";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCompanyBilling, getOpenBillingRequest, listPlanPrices } from "@/server/billing";
import { RequestCard, type RequestView } from "./request-card";
import { InvoicesTable, type InvoiceView } from "@/components/billing/invoices-table";
import { SubscriptionActions, type SubscriptionView } from "./subscription-actions";

const iso = (date: Date | null | undefined) => date?.toISOString() ?? null;

/** Superadmin > Billing > a company: its subscription, the actions on it, invoices and history. */
export default async function CompanyBillingPage({ params }: PageProps<"/[locale]/admin/billing/[tenantId]">) {
  const { locale, tenantId } = await params;
  setRequestLocale(locale);
  if (!z.uuid().safeParse(tenantId).success) notFound();
  // The layout already enforced the admin role
  const [billing, prices, request] = await Promise.all([
    getCompanyBilling(tenantId.toLowerCase()),
    listPlanPrices(),
    getOpenBillingRequest(tenantId.toLowerCase()),
  ]);
  if (!billing) notFound();
  const t = await getTranslations("Billing");
  const tp = await getTranslations("Plans.plans");
  const { row, effective } = billing;

  const subscription: SubscriptionView = {
    tenantId: billing.tenantId,
    planKey: effective.chosenPlan,
    effectivePlan: effective.plan,
    status: effective.status,
    storedStatus: row?.status ?? "active",
    cycle: (row?.cycle ?? "monthly") as SubscriptionView["cycle"],
    currencyCode: row?.currencyCode ?? "USD",
    periodStart: iso(row?.currentPeriodStart),
    paidUntil: iso(row?.currentPeriodEnd),
    trialEndsAt: iso(row?.trialEndsAt),
    graceEndsAt: iso(effective.graceEndsAt),
    pausedAt: iso(row?.pausedAt),
    pauseResumesAt: iso(row?.pauseResumesAt),
    cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
    scheduledPlanKey: isPlanKey(row?.scheduledPlanKey) ? row.scheduledPlanKey : null,
    scheduledCycle: (row?.scheduledCycle ?? null) as SubscriptionView["scheduledCycle"],
  };
  const invoices: InvoiceView[] = billing.invoices.map((invoice) => ({
    id: invoice.id,
    number: invoice.number,
    kind: invoice.kind as InvoiceView["kind"],
    planKey: isPlanKey(invoice.planKey) ? invoice.planKey : null,
    cycle: invoice.cycle as InvoiceView["cycle"],
    periodStart: iso(invoice.periodStart),
    periodEnd: iso(invoice.periodEnd),
    amountMinor: invoice.amountMinor,
    currencyCode: invoice.currencyCode,
    status: invoice.status as InvoiceView["status"],
    dueAt: invoice.dueAt.toISOString(),
    paidAt: iso(invoice.paidAt),
    voidReason: invoice.voidReason,
    note: invoice.note,
    totals: invoice.totals,
    payments: invoice.payments.map((p) => ({
      id: p.id,
      kind: p.kind as "payment" | "refund",
      method: p.method,
      amountMinor: p.amountMinor,
      reference: p.reference,
      paidAt: p.paidAt.toISOString(),
      note: p.note,
      recordedBy: p.recordedBy,
    })),
  }));
  const activePrices = prices
    .filter((p) => p.isActive)
    .map((p) => ({ planKey: p.planKey, cycle: p.cycle, currencyCode: p.currencyCode, amountMinor: p.amountMinor }));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Link href="/admin/billing" className={buttonVariants({ variant: "ghost", size: "sm", className: "self-start" })}>
          <ArrowLeftIcon />
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{billing.name}</h1>
          <Badge variant={STATUS_BADGE[effective.status]}>{t(`status.${effective.status}`)}</Badge>
        </div>
      </div>

      {request && (
        <RequestCard
          tenantId={billing.tenantId}
          request={{
            kind: request.kind as RequestView["kind"],
            planKey: isPlanKey(request.planKey) ? request.planKey : null,
            cycle: request.cycle as RequestView["cycle"],
            message: request.message,
            createdAt: request.createdAt.toISOString(),
            createdBy: request.createdBy,
          }}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("subscription.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
            <Item label={t("subscription.plan")}>
              {tp(`${effective.plan}.name`)}
              {effective.chosenPlan !== effective.plan && (
                <span className="block text-xs text-muted-foreground">{t("chosen", { plan: tp(`${effective.chosenPlan}.name`) })}</span>
              )}
            </Item>
            <Item label={t("subscription.cycle")}>
              {t(`cycles.${subscription.cycle}`)} · {subscription.currencyCode}
            </Item>
            {subscription.status === "trialing" && subscription.trialEndsAt ? (
              <Item label={t("subscription.trialEnds")}>
                <LocalDateTime iso={subscription.trialEndsAt} locale={locale} />
              </Item>
            ) : (
              <Item label={t("subscription.paidUntil")}>
                {subscription.paidUntil ? <LocalDateTime iso={subscription.paidUntil} locale={locale} /> : t("subscription.noEnd")}
              </Item>
            )}
            {subscription.graceEndsAt && (
              <Item label={t("subscription.graceEnds")}>
                <LocalDateTime iso={subscription.graceEndsAt} locale={locale} />
              </Item>
            )}
            {subscription.pausedAt && (
              <Item label={t("subscription.pausedSince")}>
                <LocalDateTime iso={subscription.pausedAt} locale={locale} />
                {subscription.pauseResumesAt && (
                  <span className="block text-xs text-muted-foreground">
                    {t("subscription.resumesAt")} <LocalDateTime iso={subscription.pauseResumesAt} locale={locale} />
                  </span>
                )}
              </Item>
            )}
            {(subscription.scheduledPlanKey || subscription.scheduledCycle) && (
              <Item label={t("subscription.scheduled")}>
                {[
                  subscription.scheduledPlanKey && tp(`${subscription.scheduledPlanKey}.name`),
                  subscription.scheduledCycle && t(`cycles.${subscription.scheduledCycle}`),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </Item>
            )}
            {subscription.cancelAtPeriodEnd && <Item label={t("subscription.cancelling")}>{t("subscription.cancellingValue")}</Item>}
          </dl>
          <SubscriptionActions subscription={subscription} prices={activePrices} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("invoices.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InvoicesTable invoices={invoices} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("history.title")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {billing.events.length === 0 ? (
            <p className="text-muted-foreground">{t("history.empty")}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {billing.events.map((event) => (
                <li key={event.id} className="flex flex-col gap-0.5 border-l-2 pl-3">
                  <span className="font-medium">
                    {t(`events.${event.type as SubscriptionEventType}`)}
                    {event.invoiceNumber !== null && ` · ${formatInvoiceNumber(event.invoiceNumber)}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    <LocalDateTime iso={event.createdAt.toISOString()} locale={locale} /> ·{" "}
                    {event.actorName ?? t(`actors.${event.actor as "admin" | "owner" | "system"}`)}
                  </span>
                  <EventChanges before={event.before} after={event.after} />
                  {event.note && (
                    <span className="text-sm whitespace-pre-line">{event.note === "replaced" ? t("history.replaced") : event.note}</span>
                  )}
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** "planKey: pro → basic" for each field an event changed (raw values: it is an audit trail). */
function EventChanges({ before, after }: { before: unknown; after: unknown }) {
  const b = (before && typeof before === "object" ? before : {}) as Record<string, unknown>;
  const a = (after && typeof after === "object" ? after : {}) as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(b), ...Object.keys(a)])];
  if (keys.length === 0) return null;
  const show = (value: unknown) => (value === null || value === undefined ? "—" : String(value));
  return (
    <ul className="font-mono text-xs text-muted-foreground">
      {keys.map((key) => (
        <li key={key}>
          {key}: {key in b ? `${show(b[key])} → ` : ""}
          {show(a[key])}
        </li>
      ))}
    </ul>
  );
}
