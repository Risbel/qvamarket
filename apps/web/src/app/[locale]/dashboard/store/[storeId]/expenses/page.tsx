import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EXPENSE_CATEGORIES, hasExpenseFilters, parseExpenseListParams } from "@/lib/expenses";
import { formatMoney } from "@/lib/money";
import { listExpenseMembers, listExpenses } from "@/server/expenses";
import { requirePanelSection } from "@/server/tenant";
import { NewExpenseButton } from "./expense-dialog";
import { ExpensesTable, type ExpenseRow } from "./expenses-table";

export default async function ExpensesPage({ params, searchParams }: PageProps<"/[locale]/dashboard/store/[storeId]/expenses">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, storeId, "expenses");
  const t = await getTranslations("Expenses");
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  // Filters, sort and page come from the URL (shareable, back button works)
  const list = parseExpenseListParams(await searchParams);
  const canWrite = merchant.can({ expense: ["create"] }) || merchant.can({ expense: ["update"] });
  const [{ rows, total, byCategory }, members] = await Promise.all([
    listExpenses(scope, list),
    canWrite ? listExpenseMembers(merchant.tenantId) : Promise.resolve([]),
  ]);

  const expenses: ExpenseRow[] = rows.map((row) => ({
    ...row,
    method: row.method as ExpenseRow["method"],
    paidAt: row.paidAt.toISOString(),
  }));
  const currencies = merchant.store.currencies.map((c) => ({ code: c.code, digits: c.digits }));

  // Totals of everything that matches (all pages), per currency: amounts never mix currencies
  const chosen = byCategory.filter((row) => list.categories.length === 0 || list.categories.includes(row.category));
  const totals = new Map<string, number>();
  for (const row of chosen) totals.set(row.currencyCode, (totals.get(row.currencyCode) ?? 0) + row.amountMinor);
  const categoryTotals = EXPENSE_CATEGORIES.flatMap((category) => {
    const amounts = chosen.filter((row) => row.category === category);
    return amounts.length ? [{ category, amounts }] : [];
  }).sort((a, b) => b.amounts.reduce((s, r) => s + r.count, 0) - a.amounts.reduce((s, r) => s + r.count, 0));
  const facets = Object.fromEntries(
    EXPENSE_CATEGORIES.map((category) => [category, byCategory.filter((row) => row.category === category).reduce((s, r) => s + r.count, 0)]),
  );
  const money = (minor: number, code: string) => formatMoney(minor, code, locale);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{t("title")}</h1>
          <p className="text-sm text-muted-foreground">{t("intro")}</p>
        </div>
        {merchant.can({ expense: ["create"] }) && (
          <NewExpenseButton currencies={currencies} defaultCurrency={merchant.store.defaultCurrency.code} members={members} />
        )}
      </div>

      {total === 0 && !hasExpenseFilters(list) ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
            <Card>
              <CardHeader>
                <CardDescription>{hasExpenseFilters(list) ? t("summary.totalFiltered") : t("summary.total")}</CardDescription>
                <CardTitle className="flex flex-col text-2xl font-semibold tabular-nums">
                  {totals.size ? [...totals].map(([code, minor]) => <span key={code}>{money(minor, code)}</span>) : "—"}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">{t("count", { count: total })}</CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardDescription>{t("summary.byCategory")}</CardDescription>
              </CardHeader>
              <CardContent>
                {categoryTotals.length === 0 ? (
                  <p className="text-sm text-muted-foreground">—</p>
                ) : (
                  <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
                    {categoryTotals.map(({ category, amounts }) => (
                      <div key={category} className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">{t(`categories.${category}`)}</dt>
                        <dd className="text-right font-medium tabular-nums">
                          {amounts.map((row) => money(row.amountMinor, row.currencyCode)).join(" · ")}
                        </dd>
                      </div>
                    ))}
                  </dl>
                )}
              </CardContent>
            </Card>
          </div>

          <ExpensesTable
            rows={expenses}
            total={total}
            params={list}
            facets={facets}
            currencies={currencies}
            defaultCurrency={merchant.store.defaultCurrency.code}
            members={members}
          />
        </>
      )}
    </div>
  );
}
