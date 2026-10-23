import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { STATUS_BADGE } from "@/lib/billing";
import { formatMoney } from "@/lib/money";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listCompanySubscriptions } from "@/server/billing";

// Status order of the list: what needs attention first
const ORDER = ["past_due", "expired", "trialing", "paused", "active", "cancelled"];

/** Superadmin > Billing: every company with its plan, status, paid-until and what it owes. */
export default async function BillingOverviewPage({ params }: PageProps<"/[locale]/admin/billing">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Billing");
  const tp = await getTranslations("Plans.plans");
  // The layout already enforced the admin role
  const companies = (await listCompanySubscriptions()).sort(
    (a, b) => ORDER.indexOf(a.effective.status) - ORDER.indexOf(b.effective.status) || a.name.localeCompare(b.name, locale),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("intro")}</p>
      </div>
      {companies.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.company")}</TableHead>
              <TableHead>{t("columns.plan")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead>{t("columns.until")}</TableHead>
              <TableHead className="text-right">{t("columns.owed")}</TableHead>
              <TableHead className="text-right">
                <span className="sr-only">{t("columns.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {companies.map((company) => {
              const { row, effective } = company;
              const until = effective.status === "trialing" ? row?.trialEndsAt : row?.currentPeriodEnd;
              return (
                <TableRow key={company.tenantId}>
                  <TableCell className="font-medium">{company.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-col">
                      <span>{tp(`${effective.plan}.name`)}</span>
                      {effective.chosenPlan !== effective.plan && (
                        <span className="text-xs text-muted-foreground">
                          {t("chosen", { plan: tp(`${effective.chosenPlan}.name`) })}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[effective.status]}>{t(`status.${effective.status}`)}</Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {until ? <LocalDateTime iso={until.toISOString()} locale={locale} /> : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {company.owed.length === 0
                      ? "—"
                      : company.owed.map((o) => formatMoney(o.amountMinor, o.currencyCode, locale)).join(" + ")}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link href={`/admin/billing/${company.tenantId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                      {t("manage")}
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
