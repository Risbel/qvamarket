import { ChevronLeftIcon, ChevronRightIcon, TriangleAlertIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { todayIn } from "@/lib/date-range";
import { EXPENSE_CATEGORIES } from "@/lib/expenses";
import { formatMoney } from "@/lib/money";
import { storePath } from "@/lib/panel-paths";
import { addMonths, LOSS_REASONS, margin, parseMonth, type ProfitMonth } from "@/lib/profit";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getProfitReport } from "@/server/profit";
import { requirePanelSection } from "@/server/tenant";

/** "octubre de 2026" from YYYY-MM (a plain calendar month, no timezone shift). */
function formatMonth(month: string, locale: string, style: "long" | "short" = "long") {
  const [y, m] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: style, year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 1)));
}

export default async function ProfitPage({ params, searchParams }: PageProps<"/[locale]/dashboard/store/[storeId]/profit">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, storeId, "profit");
  const t = await getTranslations("Profit");
  const tc = await getTranslations("Expenses.categories");
  const tr = await getTranslations("Inventory.reasons");
  const search = await searchParams;

  // Months of the store's calendar; never a future one
  const { timeZone } = merchant.store;
  const current = todayIn(timeZone).slice(0, 7);
  const month = parseMonth(search.month, current) ?? current;
  const defaultCurrency = merchant.store.defaultCurrency.code;
  const storeCodes = [defaultCurrency, ...merchant.store.currencies.map((c) => c.code).filter((code) => code !== defaultCurrency)];
  const report = await getProfitReport({ tenantId: merchant.tenantId, storeId: merchant.store.id }, timeZone, month, storeCodes);
  const chosen = report.currencies.find((c) => c.currency === search.currency) ?? report.currencies[0];
  const currency = chosen.currency;
  const data = chosen.months.at(-1)!;
  const baseCode = merchant.store.baseCurrency.code;

  const money = (minor: number) => formatMoney(minor, currency, locale);
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });
  const marginText = (profit: number, revenue: number) => {
    const value = margin(profit, revenue);
    return value === null ? null : percent.format(value / 100);
  };
  const href = (next: { month?: string; currency?: string }) => {
    const query: Record<string, string> = {};
    const m = next.month ?? month;
    const c = next.currency ?? currency;
    if (m !== current) query.month = m;
    if (c !== defaultCurrency) query.currency = c;
    return { pathname: storePath(storeId, "/profit"), query };
  };
  const uncostedLosses = report.uncostedLosses[month] ?? 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro", { zone: timeZone.replaceAll("_", " ") })}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={t("monthNav")} className="flex items-center gap-2">
          <Link href={href({ month: addMonths(month, -1) })} className={buttonVariants({ variant: "outline", size: "icon-sm" })} aria-label={t("previous")}>
            <ChevronLeftIcon />
          </Link>
          <span className="min-w-36 text-center font-medium capitalize">{formatMonth(month, locale)}</span>
          {month < current ? (
            <Link href={href({ month: addMonths(month, 1) })} className={buttonVariants({ variant: "outline", size: "icon-sm" })} aria-label={t("next")}>
              <ChevronRightIcon />
            </Link>
          ) : (
            <span className={buttonVariants({ variant: "outline", size: "icon-sm", className: "pointer-events-none opacity-50" })} aria-hidden>
              <ChevronRightIcon />
            </span>
          )}
          {month !== current && (
            <Link href={href({ month: current })} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {t("thisMonth")}
            </Link>
          )}
        </nav>
        {report.currencies.length > 1 && (
          <ButtonGroup aria-label={t("currency")}>
            {report.currencies.map((c) => (
              <Link
                key={c.currency}
                href={href({ currency: c.currency })}
                aria-current={c.currency === currency ? "true" : undefined}
                className={buttonVariants({ variant: c.currency === currency ? "default" : "outline", size: "sm" })}
              >
                {c.currency}
              </Link>
            ))}
          </ButtonGroup>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_20rem] md:items-start">
        <Card>
          <CardHeader>
            <CardDescription>{t("netProfit")}</CardDescription>
            <CardTitle className={cn("text-3xl font-semibold tabular-nums", data.netProfitMinor < 0 && "text-destructive")}>
              {money(data.netProfitMinor)}
            </CardTitle>
            {marginText(data.netProfitMinor, data.revenueMinor) && (
              <p className="text-xs text-muted-foreground">{t("margin", { percent: marginText(data.netProfitMinor, data.revenueMinor)! })}</p>
            )}
          </CardHeader>
          <CardContent>
            <dl className="flex flex-col gap-1.5 text-sm">
              <Line label={t("lines.goods", { count: data.orders })} value={money(data.goodsMinor)} />
              <Line label={t("lines.delivery")} value={money(data.deliveryMinor)} />
              <Line label={t("lines.revenue")} value={money(data.revenueMinor)} strong />
              <Line label={t("lines.costOfGoods")} value={`−${money(data.costOfGoodsMinor)}`} />
              <Separator className="my-1" />
              <Line
                label={t("lines.grossProfit")}
                value={money(data.grossProfitMinor)}
                hint={marginText(data.grossProfitMinor, data.revenueMinor)}
                strong
              />
              {LOSS_REASONS.filter((reason) => data.lossesByReason[reason] > 0).map((reason) => (
                <Line key={reason} label={t("lines.loss", { reason: tr(reason) })} value={`−${money(data.lossesByReason[reason])}`} />
              ))}
              <Line label={t("lines.expenses")} value={`−${money(data.expensesMinor)}`} />
              <Separator className="my-1" />
              <Line label={t("lines.netProfit")} value={money(data.netProfitMinor)} strong negative={data.netProfitMinor < 0} />
            </dl>
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardDescription>{t("expensesByCategory")}</CardDescription>
            </CardHeader>
            <CardContent>
              {data.expensesMinor === 0 ? (
                <p className="text-sm text-muted-foreground">{t("noExpenses")}</p>
              ) : (
                <dl className="flex flex-col gap-1.5 text-sm">
                  {EXPENSE_CATEGORIES.filter((category) => data.expensesByCategory[category] > 0)
                    .sort((a, b) => data.expensesByCategory[b] - data.expensesByCategory[a])
                    .map((category) => (
                      <Line key={category} label={tc(category)} value={money(data.expensesByCategory[category])} />
                    ))}
                </dl>
              )}
            </CardContent>
          </Card>
          {(data.uncostedUnits > 0 || uncostedLosses > 0 || currency !== baseCode) && (
            <div className="flex flex-col gap-2 rounded-lg border p-3 text-xs text-muted-foreground" role="note">
              {data.uncostedUnits > 0 && (
                <p className="flex gap-2">
                  <TriangleAlertIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden />
                  {t("warnings.uncostedSales", { count: data.uncostedUnits })}
                </p>
              )}
              {uncostedLosses > 0 && (
                <p className="flex gap-2">
                  <TriangleAlertIcon className="size-4 shrink-0 text-amber-600 dark:text-amber-500" aria-hidden />
                  {t("warnings.uncostedLosses", { count: uncostedLosses })}
                </p>
              )}
              {currency !== baseCode && <p>{t("warnings.otherCurrency", { currency, base: baseCode })}</p>}
            </div>
          )}
        </div>
      </div>

      <section className="flex flex-col gap-3" aria-labelledby="profit-months">
        <h2 id="profit-months" className="text-lg font-semibold">
          {t("months.title")}
        </h2>
        <div className="overflow-hidden rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("months.month")}</TableHead>
                <TableHead className="text-right">{t("lines.revenue")}</TableHead>
                <TableHead className="text-right">{t("lines.grossProfit")}</TableHead>
                <TableHead className="text-right">{t("months.lossesAndExpenses")}</TableHead>
                <TableHead className="text-right">{t("lines.netProfit")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...chosen.months].reverse().map((row: ProfitMonth) => (
                <TableRow key={row.month} data-state={row.month === month ? "selected" : undefined}>
                  <TableCell>
                    <Link href={href({ month: row.month })} className="capitalize underline-offset-4 hover:underline">
                      {formatMonth(row.month, locale, "short")}
                    </Link>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.revenueMinor)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.grossProfitMinor)}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(row.lossesMinor + row.expensesMinor)}</TableCell>
                  <TableCell className={cn("text-right font-medium tabular-nums", row.netProfitMinor < 0 && "text-destructive")}>
                    {money(row.netProfitMinor)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}

function Line({
  label,
  value,
  hint,
  strong = false,
  negative = false,
}: {
  label: string;
  value: string;
  hint?: string | null;
  strong?: boolean;
  negative?: boolean;
}) {
  return (
    <div className="flex justify-between gap-3">
      <dt className={strong ? "font-medium" : "text-muted-foreground"}>{label}</dt>
      <dd className={cn("text-right tabular-nums", strong && "font-semibold", negative && "text-destructive")}>
        {value}
        {hint && <span className="ml-1 text-xs font-normal text-muted-foreground">({hint})</span>}
      </dd>
    </div>
  );
}
