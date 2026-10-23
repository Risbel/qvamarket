import { CheckIcon, MinusIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatMoney } from "@/lib/money";
import { PLAN_FEATURES, PLAN_KEYS, catalogHas } from "@/lib/plans";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listPlanPrices } from "@/server/billing";
import { getPlanCatalog } from "@/server/subscriptions";
import { PlanDialog } from "./plan-dialog";
import { PriceDialog } from "./price-dialog";

/** Superadmin > Prices: what each plan includes and whether it is offered, then what each paid plan costs per cycle and currency. */
export default async function PricesPage({ params }: PageProps<"/[locale]/admin/prices">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Billing.prices");
  const tp = await getTranslations("Plans.plans");
  const tc = await getTranslations("Billing.cycles");
  const ts = await getTranslations("Billing.plansSection");
  const tf = await getTranslations("CompanyBilling.features");
  // The layout already enforced the admin role
  const [prices, catalog] = await Promise.all([listPlanPrices(), getPlanCatalog()]);
  const rank = (plan: string) => ["basic", "pro", "business"].indexOf(plan);
  const cycles = ["monthly", "quarterly", "yearly"];
  const rows = [...prices].sort(
    (a, b) => rank(a.planKey) - rank(b.planKey) || cycles.indexOf(a.cycle) - cycles.indexOf(b.cycle) || a.currencyCode.localeCompare(b.currencyCode),
  );

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="plans-title" className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h1 id="plans-title" className="text-2xl font-semibold">
            {ts("title")}
          </h1>
          <p className="text-muted-foreground">{ts("intro")}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {PLAN_KEYS.map((plan) => (
            <div key={plan} className={cn("flex flex-col gap-3 rounded-lg border p-4", !catalog[plan].offered && "border-dashed")}>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{tp(`${plan}.name`)}</span>
                <Badge variant={catalog[plan].offered ? "default" : "secondary"}>{ts(catalog[plan].offered ? "offered" : "notOffered")}</Badge>
              </div>
              <ul className="flex flex-col gap-1 text-sm">
                {PLAN_FEATURES.map((feature) => {
                  const has = catalogHas(catalog, plan, feature);
                  return (
                    <li key={feature} className={cn("flex items-center gap-1.5", !has && "text-muted-foreground")}>
                      {has ? <CheckIcon className="size-4 text-primary" aria-hidden /> : <MinusIcon className="size-4" aria-hidden />}
                      <span className={cn(!has && "line-through")}>{tf(feature)}</span>
                      <span className="sr-only">{ts(has ? "included" : "notIncluded")}</span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-auto">
                <PlanDialog setting={{ planKey: plan, features: catalog[plan].features, offered: catalog[plan].offered }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold">{t("title")}</h2>
          <p className="text-muted-foreground">{t("intro")}</p>
        </div>
        <PriceDialog />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("plan")}</TableHead>
            <TableHead>{t("cycle")}</TableHead>
            <TableHead>{t("currency")}</TableHead>
            <TableHead className="text-right">{t("amount")}</TableHead>
            <TableHead>{t("state")}</TableHead>
            <TableHead className="text-right">
              <span className="sr-only">{t("actions")}</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((price) => (
            <TableRow key={`${price.planKey}-${price.cycle}-${price.currencyCode}`}>
              <TableCell className="font-medium">{tp(`${price.planKey as "basic" | "pro" | "business"}.name`)}</TableCell>
              <TableCell>{tc(price.cycle as "monthly" | "quarterly" | "yearly")}</TableCell>
              <TableCell>{price.currencyCode}</TableCell>
              <TableCell className="text-right tabular-nums">{formatMoney(price.amountMinor, price.currencyCode, locale)}</TableCell>
              <TableCell>
                <Badge variant={price.isActive ? "default" : "secondary"}>{t(price.isActive ? "active" : "inactive")}</Badge>
              </TableCell>
              <TableCell className="text-right">
                <PriceDialog
                  price={{
                    planKey: price.planKey as "basic" | "pro" | "business",
                    cycle: price.cycle as "monthly" | "quarterly" | "yearly",
                    currencyCode: price.currencyCode,
                    amountMinor: price.amountMinor,
                    isActive: price.isActive,
                  }}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
