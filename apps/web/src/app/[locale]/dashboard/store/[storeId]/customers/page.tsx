import { getTranslations, setRequestLocale } from "next-intl/server";
import { parseCustomerListParams } from "@/lib/customer-list";
import { listCustomers, listOrderCurrencies } from "@/server/customers";
import { requirePanelSection } from "@/server/tenant";
import { CustomersTable, type CustomerRow } from "./customers-table";

export default async function CustomersPage({ params, searchParams }: PageProps<"/[locale]/dashboard/store/[storeId]/customers">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, storeId, "customers");
  const t = await getTranslations("Customers");

  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  // Search, sort, page and currency come from the URL (shareable, back button works)
  const list = parseCustomerListParams(await searchParams);
  // The store's currencies (default first), plus any other its orders were placed in
  const defaultCurrency = merchant.store.defaultCurrency.code;
  const storeCodes = [defaultCurrency, ...merchant.store.currencies.map((c) => c.code).filter((code) => code !== defaultCurrency)];
  const currencies = [...storeCodes, ...(await listOrderCurrencies(scope)).filter((code) => !storeCodes.includes(code))];
  if (!currencies.includes(list.currency) || list.currency === defaultCurrency) list.currency = "";
  const currency = list.currency || defaultCurrency;
  const { customers, total } = await listCustomers(scope, list, currency);

  const rows: CustomerRow[] = customers.map((c) => ({
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    hasAccount: c.hasAccount,
    orders: c.orders,
    spentMinor: c.spentMinor,
    lastOrderAt: c.lastOrderAt.toISOString(),
  }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {total === 0 && list.query === "" ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <CustomersTable
          rows={rows}
          total={total}
          params={list}
          currency={currency}
          currencies={currencies}
          defaultCurrency={defaultCurrency}
        />
      )}
    </div>
  );
}
