"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Bar, BarChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { useStorePath } from "@/components/panel-scope";
import { Link } from "@/i18n/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { grossProfit, type CurrencyIncome, type IncomeSummary as Summary, type PeriodIncome, type SellerSales } from "@/lib/income";
import { currencyDigits, formatMoney } from "@/lib/money";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/orders";

// Categorical slots 1-3 of the dataviz reference palette (validated all-pairs for color
// vision deficiencies in both themes). The cards above the chart carry the exact numbers.
const METHOD_COLORS: Record<PaymentMethod, { light: string; dark: string }> = {
  cash: { light: "#2a78d6", dark: "#3987e5" },
  transfer: { light: "#eb6834", dark: "#d95926" },
  other: { light: "#1baf7a", dark: "#199e70" },
};

/** A store day (YYYY-MM-DD) formatted as a plain calendar date (no timezone shift). */
function formatDay(day: string, locale: string, options: Intl.DateTimeFormatOptions) {
  const [y, m, d] = day.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { ...options, timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, d)));
}

/**
 * `showProfit`: the member may also see costs (inventory:read), so gross profit is shown.
 * `profitLink`: they may open the profit report.
 * `advanced`: the plan includes the full report (collected by method, 30-day chart); without
 * it each period shows only its sales (orders, units, total). `upgradeHref`: where an owner
 * can see the plans (shown under the basic cards).
 */
export function IncomeSummary({
  summary,
  showProfit,
  profitLink,
  advanced,
  upgradeHref,
  sellers,
}: {
  summary: Summary;
  showProfit: boolean;
  profitLink: boolean;
  advanced: boolean;
  upgradeHref: string | null;
  /** sales per seller (advanced plans only; null otherwise) */
  sellers: SellerSales[] | null;
}) {
  const t = useTranslations("Dashboard.income");
  const panelPath = useStorePath();
  const locale = useLocale();
  const [code, setCode] = useState(summary.currencies[0]?.currency);
  const current = summary.currencies.find((c) => c.currency === code) ?? summary.currencies[0];
  if (!current) return null;

  const periods = [
    { key: "today", label: t("today"), detail: formatDay(summary.today, locale, { day: "numeric", month: "long" }) },
    { key: "month", label: t("month"), detail: formatDay(summary.today, locale, { month: "long", year: "numeric" }) },
    { key: "year", label: t("year"), detail: summary.today.slice(0, 4) },
  ] as const;

  return (
    <section aria-labelledby="income-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="income-title" className="text-lg font-semibold">
            {t("title")}
          </h2>
          <p className="text-sm text-muted-foreground">{t("timeZone", { zone: summary.timeZone.replaceAll("_", " ") })}</p>
          {profitLink && (
            <Link href={panelPath("/profit")} className={buttonVariants({ variant: "link", size: "sm", className: "h-auto px-0" })}>
              {t("profitLink")}
            </Link>
          )}
        </div>
        {summary.currencies.length > 1 && (
          <ButtonGroup aria-label={t("currency")}>
            {summary.currencies.map((c) => (
              <Button
                key={c.currency}
                type="button"
                size="sm"
                variant={c.currency === current.currency ? "default" : "outline"}
                aria-pressed={c.currency === current.currency}
                onClick={() => setCode(c.currency)}
              >
                {c.currency}
              </Button>
            ))}
          </ButtonGroup>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        {periods.map((period) =>
          advanced ? (
            <PeriodCard
              key={period.key}
              label={period.label}
              detail={period.detail}
              income={current[period.key]}
              currency={current.currency}
              showProfit={showProfit}
            />
          ) : (
            <SalesCard key={period.key} label={period.label} detail={period.detail} income={current[period.key]} currency={current.currency} />
          ),
        )}
      </div>

      {advanced ? (
        <>
          <DailyChart income={current} />
          {sellers && <SellersCard sellers={sellers.filter((s) => s.currency === current.currency)} currency={current.currency} />}
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          {t("basicHint")}{" "}
          {upgradeHref && (
            <Link href={upgradeHref} className="font-medium underline underline-offset-4">
              {t("seePlans")}
            </Link>
          )}
        </p>
      )}
    </section>
  );
}

/** The basic plans' card: what was sold in the period (orders not cancelled). */
function SalesCard({ label, detail, income, currency }: { label: string; detail: string; income: PeriodIncome; currency: string }) {
  const t = useTranslations("Dashboard.income");
  const locale = useLocale();
  return (
    <Card>
      <CardHeader>
        <CardDescription>
          {label} · {detail}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold">{formatMoney(income.salesMinor, currency, locale)}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("soldTotal")}</p>
      </CardHeader>
      <CardContent>
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t("ordersLabel")}</dt>
            <dd className="font-medium tabular-nums">{income.orders}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t("unitsLabel")}</dt>
            <dd className="font-medium tabular-nums">{income.units}</dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

function PeriodCard({
  label,
  detail,
  income,
  currency,
  showProfit,
}: {
  label: string;
  detail: string;
  income: PeriodIncome;
  currency: string;
  showProfit: boolean;
}) {
  const t = useTranslations("Dashboard.income");
  const locale = useLocale();
  const money = (minor: number) => formatMoney(minor, currency, locale);

  return (
    <Card>
      <CardHeader>
        <CardDescription>
          {label} · {detail}
        </CardDescription>
        <CardTitle className="text-2xl font-semibold">{money(income.collectedMinor)}</CardTitle>
        <p className="text-xs text-muted-foreground">{t("collected")}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <dl className="flex flex-col gap-1.5">
          {PAYMENT_METHODS.map((method) => (
            <div key={method} className="flex items-center justify-between gap-2">
              <dt className="flex items-center gap-2 text-muted-foreground">
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-[2px] bg-(--method-light) dark:bg-(--method-dark)"
                  style={
                    {
                      "--method-light": METHOD_COLORS[method].light,
                      "--method-dark": METHOD_COLORS[method].dark,
                    } as React.CSSProperties
                  }
                />
                {t(`methods.${method}`)}
              </dt>
              <dd className="font-medium tabular-nums">{money(income.byMethod[method])}</dd>
            </div>
          ))}
        </dl>
        <Separator />
        <dl className="flex flex-col gap-1.5">
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t("sales", { count: income.orders })}</dt>
            <dd className="font-medium tabular-nums">{money(income.salesMinor)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t("unitsLabel")}</dt>
            <dd className="font-medium tabular-nums">{income.units}</dd>
          </div>
          {income.refundsMinor > 0 && (
            <div className="flex justify-between gap-2">
              <dt className="text-muted-foreground">{t("refunds")}</dt>
              <dd className="font-medium tabular-nums">−{money(income.refundsMinor)}</dd>
            </div>
          )}
          {showProfit && <ProfitRow income={income} money={money} />}
        </dl>
      </CardContent>
    </Card>
  );
}

/** Gross profit of the goods with a cost, its margin, and how many units had none. */
function ProfitRow({ income, money }: { income: PeriodIncome; money: (minor: number) => string }) {
  const t = useTranslations("Dashboard.income");
  const locale = useLocale();
  const { profitMinor, marginPercent } = grossProfit(income);
  const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 });

  return (
    <>
      <div className="flex justify-between gap-2">
        <dt className="text-muted-foreground">{t("grossProfit")}</dt>
        <dd className="text-right font-medium tabular-nums">
          {income.costedGoodsMinor > 0 ? money(profitMinor) : "—"}
          {marginPercent !== null && (
            <span className="ml-1 text-xs font-normal text-muted-foreground">
              {t("margin", { percent: percent.format(marginPercent / 100) })}
            </span>
          )}
        </dd>
      </div>
      {income.uncostedUnits > 0 && (
        <p className="text-xs text-muted-foreground">{t("uncosted", { count: income.uncostedUnits })}</p>
      )}
    </>
  );
}

function DailyChart({ income }: { income: CurrencyIncome }) {
  const t = useTranslations("Dashboard.income");
  const locale = useLocale();
  const { currency } = income;
  const scale = 10 ** currencyDigits(currency);
  const compact = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });

  const config = Object.fromEntries(
    PAYMENT_METHODS.map((method) => [method, { label: t(`methods.${method}`), theme: METHOD_COLORS[method] }]),
  ) satisfies ChartConfig;
  const data = income.daily.map((point) => ({ day: point.day, ...point.byMethod }));
  const hasRefundDay = data.some((point) => PAYMENT_METHODS.some((method) => point[method] < 0));

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("chartTitle")}</CardTitle>
        <CardDescription>{t("chartDescription", { currency })}</CardDescription>
      </CardHeader>
      <CardContent>
        <ChartContainer config={config} className="aspect-auto h-64 w-full" aria-label={t("chartTitle")} role="img">
          <BarChart data={data} stackOffset="sign" margin={{ left: 0, right: 8 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              minTickGap={24}
              tickFormatter={(day: string) => formatDay(day, locale, { day: "numeric", month: "short" })}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              width={48}
              tickFormatter={(minor: number) => compact.format(minor / scale)}
            />
            {hasRefundDay && <ReferenceLine y={0} className="stroke-border" />}
            <ChartTooltip
              cursor={false}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null;
                const point = payload[0].payload as (typeof data)[number];
                const total = PAYMENT_METHODS.reduce((sum, method) => sum + point[method], 0);
                return (
                  <div className="grid min-w-44 gap-1.5 rounded-lg border bg-background px-2.5 py-1.5 text-xs shadow-xl">
                    <p className="font-medium">{formatDay(String(label), locale, { weekday: "short", day: "numeric", month: "long" })}</p>
                    {PAYMENT_METHODS.map((method) => (
                      <div key={method} className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-1.5 text-muted-foreground">
                          <span aria-hidden className="size-2.5 rounded-[2px]" style={{ backgroundColor: `var(--color-${method})` }} />
                          {t(`methods.${method}`)}
                        </span>
                        <span className="font-mono font-medium tabular-nums">{formatMoney(point[method], currency, locale)}</span>
                      </div>
                    ))}
                    <div className="flex justify-between gap-3 border-t pt-1.5">
                      <span>{t("collected")}</span>
                      <span className="font-mono font-medium tabular-nums">{formatMoney(total, currency, locale)}</span>
                    </div>
                  </div>
                );
              }}
            />
            <ChartLegend content={<ChartLegendContent />} />
            {PAYMENT_METHODS.map((method) => (
              <Bar
                key={method}
                dataKey={method}
                stackId="collected"
                fill={`var(--color-${method})`}
                stroke="var(--card)"
                strokeWidth={1}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}

/**
 * Sales of today and this month per seller: the online store and each team member who sold
 * at the counter. Shown once the store has counter sales this month.
 */
function SellersCard({ sellers, currency }: { sellers: SellerSales[]; currency: string }) {
  const t = useTranslations("Dashboard.income");
  const locale = useLocale();
  if (!sellers.some((s) => s.channel === "pos")) return null;
  const amount = (sales: { orders: number; totalMinor: number }) => (
    <>
      <span className="block font-medium tabular-nums">{formatMoney(sales.totalMinor, currency, locale)}</span>
      <span className="block text-xs text-muted-foreground">{t("ordersCount", { count: sales.orders })}</span>
    </>
  );
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("sellersTitle")}</CardTitle>
        <CardDescription>{t("sellersDescription", { currency })}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("seller")}</TableHead>
              <TableHead className="text-right">{t("today")}</TableHead>
              <TableHead className="text-right">{t("month")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sellers.map((s) => (
              <TableRow key={`${s.channel}-${s.sellerId ?? ""}`}>
                <TableCell>{s.channel === "online" ? t("onlineStore") : (s.name ?? t("formerMember"))}</TableCell>
                <TableCell className="text-right">{amount(s.today)}</TableCell>
                <TableCell className="text-right">{amount(s.month)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
