import { getTranslations, setRequestLocale } from "next-intl/server";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { inventoryValue, LOW_STOCK } from "@/lib/inventory";
import { formatMoney } from "@/lib/money";
import { listInventory } from "@/server/inventory";
import { requirePanelSection } from "@/server/tenant";
import { InventoryTable, type InventoryRow } from "./inventory-table";

export default async function InventoryPage({ params }: PageProps<"/[locale]/dashboard/store/[storeId]/inventory">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, storeId, "inventory");
  const t = await getTranslations("Inventory");
  const variants = await listInventory({ tenantId: merchant.tenantId, storeId: merchant.store.id });

  const rows: InventoryRow[] = variants.map((v) => ({
    id: v.id,
    productId: v.productId,
    productName: v.productName,
    productStatus: v.productStatus as InventoryRow["productStatus"],
    title: v.title,
    sku: v.sku,
    stock: v.stock,
    cost: v.costMinor === null || v.costCurrencyCode === null ? null : { minor: v.costMinor, currencyCode: v.costCurrencyCode },
  }));

  // Summary of the stock that is counted (untracked variants have no units to add up)
  const tracked = rows.filter((row) => row.stock !== null);
  const units = tracked.reduce((sum, row) => sum + (row.stock ?? 0), 0);
  const values = new Map<string, number>();
  for (const row of tracked) {
    const value = inventoryValue(row.stock, row.cost?.minor ?? null);
    if (value !== null && row.cost) values.set(row.cost.currencyCode, (values.get(row.cost.currencyCode) ?? 0) + value);
  }
  const withoutCost = rows.filter((row) => row.cost === null).length;
  const low = tracked.filter((row) => (row.stock ?? 0) <= LOW_STOCK).length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat title={t("stats.units")} value={units.toLocaleString(locale)} description={t("stats.unitsHelp", { count: tracked.length })} />
        <Stat
          title={t("stats.value")}
          value={
            values.size === 0
              ? "—"
              : [...values].map(([code, minor]) => formatMoney(minor, code, locale)).join(" · ")
          }
          description={t("stats.valueHelp")}
        />
        <Stat title={t("stats.withoutCost")} value={String(withoutCost)} description={t("stats.withoutCostHelp")} />
        <Stat title={t("stats.low")} value={String(low)} description={t("stats.lowHelp", { max: LOW_STOCK })} />
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <InventoryTable rows={rows} baseCurrency={merchant.store.baseCurrency} />
      )}
    </div>
  );
}

function Stat({ title, value, description }: { title: string; value: string; description: string }) {
  return (
    <Card>
      <CardHeader>
        <CardDescription>{title}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">{description}</CardContent>
    </Card>
  );
}
