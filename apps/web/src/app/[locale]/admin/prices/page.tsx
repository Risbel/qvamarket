import { getTranslations, setRequestLocale } from "next-intl/server";
import { formatMoney } from "@/lib/money";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listPlanPrices } from "@/server/billing";
import { PriceDialog } from "./price-dialog";

/** Superadmin > Prices: what each paid plan costs per cycle and currency. */
export default async function PricesPage({ params }: PageProps<"/[locale]/admin/prices">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Billing.prices");
  const tp = await getTranslations("Plans.plans");
  const tc = await getTranslations("Billing.cycles");
  // The layout already enforced the admin role
  const prices = await listPlanPrices();
  const rank = (plan: string) => ["basic", "pro", "business"].indexOf(plan);
  const cycles = ["monthly", "quarterly", "yearly"];
  const rows = [...prices].sort(
    (a, b) => rank(a.planKey) - rank(b.planKey) || cycles.indexOf(a.cycle) - cycles.indexOf(b.cycle) || a.currencyCode.localeCompare(b.currencyCode),
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
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
