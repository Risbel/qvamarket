import { getTranslations, setRequestLocale } from "next-intl/server";
import { hasOrderFilters, parseOrderListParams } from "@/lib/order-list";
import type { OrderStatus, PaymentStatus } from "@/lib/orders";
import { countOrderFacets, listOrders } from "@/server/orders";
import { requirePanelSection } from "@/server/tenant";
import { OrdersTable, type OrderRow } from "./orders-table";

export default async function OrdersPage({ params, searchParams }: PageProps<"/[locale]/dashboard/store/[storeId]/orders">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, storeId, "orders");
  const t = await getTranslations("Orders");
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };

  // Filters, sort and page come from the URL (shareable, back button works); anything
  // unexpected is ignored. Dates are days in the timezone the URL names (see date-filter.tsx)
  const list = parseOrderListParams(await searchParams);
  const canSeePayments = merchant.can({ payment: ["read"] });
  const [{ orders, total }, facets] = await Promise.all([
    listOrders(scope, list, { withPayments: canSeePayments }),
    countOrderFacets(scope, list),
  ]);

  const rows: OrderRow[] = orders.map((o) => ({
    id: o.id,
    number: o.number,
    createdAt: o.createdAt.toISOString(),
    customerName: o.customerName,
    customerPhone: o.customerPhone,
    status: o.status as OrderStatus,
    paymentStatus: o.paymentStatus as PaymentStatus,
    paymentMethods: o.paymentMethods,
    fulfillmentType: o.fulfillmentType,
    currencyCode: o.currencyCode,
    totalMinor: o.totalMinor,
    units: o.units,
  }));

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {total === 0 && !hasOrderFilters(list) ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <OrdersTable rows={rows} total={total} facets={facets} params={list} showMethods={canSeePayments} />
      )}
    </div>
  );
}
