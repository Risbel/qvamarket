import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { InvoicesTable, type InvoiceView } from "@/components/billing/invoices-table";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { STATUS_BADGE, type BillingCycle, type SubscriptionEventType } from "@/lib/billing";
import { PLANS, isPlanKey, type PlanLimit } from "@/lib/plans";
import { getCompanyBilling, getOpenBillingRequest, listPlanPrices } from "@/server/billing";
import { getPlanUsage } from "@/server/subscriptions";
import { requireCompany } from "@/server/tenant";
import { BillingControls, type OwnerSubscriptionView } from "./billing-controls";

const iso = (date: Date | null | undefined) => date?.toISOString() ?? null;

// Events an owner sees in their history (the rest is the platform's own bookkeeping)
const OWNER_EVENTS: SubscriptionEventType[] = [
  "trial_started",
  "trial_ended",
  "plan_upgraded",
  "plan_downgraded",
  "downgrade_scheduled",
  "downgrade_cancelled",
  "cycle_changed",
  "paused",
  "resumed",
  "cancel_scheduled",
  "reactivated",
  "cancelled",
  "renewed",
  "invoice_issued",
  "payment_recorded",
  "refund_recorded",
  "became_past_due",
  "expired",
  "period_adjusted",
  "trial_adjusted",
  "change_requested",
  "request_closed",
];

/** The company's plan, what it uses of it, its invoices, and changes it can make or ask for. Owners only. */
export default async function CompanyBillingPage({ params }: PageProps<"/[locale]/dashboard/org/[orgId]/billing">) {
  const { locale, orgId } = await params;
  setRequestLocale(locale);
  const company = await requireCompany(locale, orgId);
  if (!company.isOwner) notFound();
  const t = await getTranslations("CompanyBilling");
  const tb = await getTranslations("Billing");
  const tp = await getTranslations("Plans.plans");

  const [billing, prices, request, usage] = await Promise.all([
    getCompanyBilling(company.tenantId),
    listPlanPrices(),
    getOpenBillingRequest(company.tenantId),
    getPlanUsage(company.tenantId),
  ]);
  if (!billing) notFound();
  const { row, effective } = billing;
  const plan = PLANS[effective.plan];

  const subscription: OwnerSubscriptionView = {
    planKey: effective.chosenPlan,
    effectivePlan: effective.plan,
    status: effective.status,
    cycle: (row?.cycle ?? "monthly") as BillingCycle,
    currencyCode: row?.currencyCode ?? "USD",
    paidUntil: iso(row?.currentPeriodEnd),
    cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
    scheduledPlanKey: isPlanKey(row?.scheduledPlanKey) ? row.scheduledPlanKey : null,
    scheduledCycle: (row?.scheduledCycle ?? null) as BillingCycle | null,
  };
  const invoices: InvoiceView[] = billing.invoices
    .filter((invoice) => invoice.status !== "void")
    .map((invoice) => ({
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
      voidReason: null,
      note: invoice.note,
      totals: invoice.totals,
      payments: invoice.payments.map((p) => ({
        id: p.id,
        kind: p.kind as "payment" | "refund",
        method: p.method,
        amountMinor: p.amountMinor,
        reference: p.reference,
        paidAt: p.paidAt.toISOString(),
        note: null,
        recordedBy: null,
      })),
    }));
  const events = billing.events.filter((event) => OWNER_EVENTS.includes(event.type as SubscriptionEventType)).slice(0, 50);

  // Usage: company-wide limits, then per store (the highest store counts against the limit)
  const usageRows: { limit: PlanLimit; used: number }[] = [
    { limit: "stores", used: usage.stores },
    { limit: "members", used: usage.members },
  ];
  const storeLimits: PlanLimit[] = ["activeProducts", "currencies", "pages", "bannerImages"];

  return (
    <div className="flex flex-col gap-6 p-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2 className="flex flex-wrap items-center gap-2">
              {t("currentPlan", { plan: tp(`${effective.plan}.name`) })}
              <Badge variant={STATUS_BADGE[effective.status]}>{tb(`status.${effective.status}`)}</Badge>
            </h2>
          </CardTitle>
          <CardDescription>{tp(`${effective.plan}.description`)}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <StatusLine subscription={subscription} trialEndsAt={iso(row?.trialEndsAt)} graceEndsAt={iso(effective.graceEndsAt)} pauseResumesAt={iso(row?.pauseResumesAt)} locale={locale} />
          <BillingControls
            subscription={subscription}
            catalog={company.planCatalog}
            prices={prices.filter((p) => p.isActive).map((p) => ({ planKey: p.planKey, cycle: p.cycle, currencyCode: p.currencyCode, amountMinor: p.amountMinor }))}
            request={
              request
                ? {
                    kind: request.kind as "plan" | "pause" | "other",
                    planKey: isPlanKey(request.planKey) ? request.planKey : null,
                    cycle: request.cycle as BillingCycle | null,
                    message: request.message,
                    createdAt: request.createdAt.toISOString(),
                  }
                : null
            }
            whatsapp={process.env.PLATFORM_WHATSAPP?.match(/^\+\d{8,15}$/) ? process.env.PLATFORM_WHATSAPP : null}
            companyName={company.companyName}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("usage.title")}</h2>
          </CardTitle>
          <CardDescription>{t("usage.description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <dl className="grid gap-3 sm:grid-cols-2">
            {usageRows.map(({ limit, used }) => (
              <UsageItem key={limit} label={t(`usage.limits.${limit}`)} used={used} max={plan.limits[limit]} />
            ))}
          </dl>
          {usage.perStore.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("usage.store")}</TableHead>
                  {storeLimits.map((limit) => (
                    <TableHead key={limit} className="text-right">
                      {t(`usage.limits.${limit}`)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {usage.perStore.map((s) => (
                  <TableRow key={s.storeId}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    {storeLimits.map((limit) => {
                      const used = s[limit as "activeProducts" | "currencies" | "pages" | "bannerImages"];
                      const max = plan.limits[limit];
                      return (
                        <TableCell key={limit} className={`text-right tabular-nums ${max !== null && used > max ? "text-destructive" : ""}`}>
                          {max === null ? used : t("usage.of", { used, max })}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-sm text-muted-foreground">{t("usage.over")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("invoices")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InvoicesTable invoices={invoices} readOnly />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            <h2>{t("history")}</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-muted-foreground">{tb("history.empty")}</p>
          ) : (
            <ol className="flex flex-col gap-2">
              {events.map((event) => (
                <li key={event.id} className="flex flex-wrap justify-between gap-x-3 border-l-2 pl-3">
                  <span>{tb(`events.${event.type as SubscriptionEventType}`)}</span>
                  <span className="text-sm text-muted-foreground">
                    <LocalDateTime iso={event.createdAt.toISOString()} locale={locale} />
                  </span>
                </li>
              ))}
            </ol>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function UsageItem({ label, used, max }: { label: string; used: number; max: number | null }) {
  const over = max !== null && used > max;
  return (
    <div className="flex flex-col gap-1 rounded-md border p-3">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className={`text-lg font-semibold tabular-nums ${over ? "text-destructive" : ""}`}>
        {used}
        {max !== null && <span className="text-sm font-normal text-muted-foreground"> / {max}</span>}
      </dd>
    </div>
  );
}

async function StatusLine({
  subscription: s,
  trialEndsAt,
  graceEndsAt,
  pauseResumesAt,
  locale,
}: {
  subscription: OwnerSubscriptionView;
  trialEndsAt: string | null;
  graceEndsAt: string | null;
  pauseResumesAt: string | null;
  locale: string;
}) {
  const t = await getTranslations("CompanyBilling.statusLine");
  const tp = await getTranslations("Plans.plans");
  const tc = await getTranslations("Billing.cycles");
  const line = (key: string, iso: string | null, values: Record<string, string> = {}) => (
    <p>
      {t(key, values)} {iso && <LocalDateTime iso={iso} locale={locale} />}
    </p>
  );
  return (
    <div className="flex flex-col gap-1 text-sm">
      {s.status === "trialing" && line("trial", trialEndsAt)}
      {s.status === "active" && s.paidUntil && line("paidUntil", s.paidUntil, { cycle: tc(s.cycle) })}
      {s.status === "active" && !s.paidUntil && s.effectivePlan !== "free" && <p>{t("noEnd")}</p>}
      {s.status === "past_due" && line("pastDue", graceEndsAt)}
      {s.status === "paused" && line(pauseResumesAt ? "pausedUntil" : "paused", pauseResumesAt)}
      {(s.status === "expired" || s.status === "cancelled") && <p>{t(s.status, { plan: tp(`${s.planKey}.name`) })}</p>}
      {s.scheduledPlanKey && line("scheduled", s.paidUntil, { plan: tp(`${s.scheduledPlanKey}.name`) })}
      {s.cancelAtPeriodEnd && line("cancelling", s.paidUntil)}
    </div>
  );
}
