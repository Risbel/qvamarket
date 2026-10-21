import { storePath } from "@/lib/panel-paths";
import { notFound } from "next/navigation";
import { ArrowLeftIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { HISTORY_MAX, inventoryValue, type InventoryReason } from "@/lib/inventory";
import { formatMoney } from "@/lib/money";
import { orderReference } from "@/lib/orders";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getVariantHistory } from "@/server/inventory";
import { requirePanelSection } from "@/server/tenant";

/** Movements that orders write (the rest are manual changes by the team). */
const ORDER_REASONS: InventoryReason[] = ["sale", "cancel", "order_edit"];

export default async function VariantHistoryPage({
  params,
}: PageProps<"/[locale]/dashboard/store/[storeId]/inventory/[variantId]">) {
  const { locale, storeId, variantId } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, storeId, "inventory");
  if (!z.uuid().safeParse(variantId).success) notFound();
  const found = await getVariantHistory({ tenantId: merchant.tenantId, storeId: merchant.store.id }, variantId.toLowerCase());
  if (!found) notFound();

  const t = await getTranslations("Inventory");
  const canOpenOrders = merchant.can({ order: ["read"] });
  const { variant, movements } = found;
  const cost = variant.costMinor !== null && variant.costCurrencyCode !== null ? { minor: variant.costMinor, code: variant.costCurrencyCode } : null;
  const value = inventoryValue(variant.stock, cost?.minor ?? null);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
      <div className="flex flex-col gap-3">
        <Link
          href={storePath(storeId, "/inventory")}
          className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2 w-fit" })}
        >
          <ArrowLeftIcon />
          {t("history.back")}
        </Link>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold">{variant.productName}</h1>
          <p className="text-sm text-muted-foreground">
            {[variant.title, variant.sku && t("history.sku", { sku: variant.sku })].filter(Boolean).join(" · ") ||
              t("history.subtitle")}
          </p>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t("columns.stock")}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {variant.stock === null ? t("untracked") : variant.stock.toLocaleString(locale)}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t("columns.cost")}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">{cost ? formatMoney(cost.minor, cost.code, locale) : "—"}</CardTitle>
          </CardHeader>
        </Card>
        <Card size="sm">
          <CardHeader>
            <CardDescription>{t("columns.value")}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {value !== null && cost ? formatMoney(value, cost.code, locale) : "—"}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold">{t("history.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("history.help", { max: HISTORY_MAX })}</p>
        </div>
        {movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("history.empty")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("history.columns.date")}</TableHead>
                <TableHead>{t("history.columns.reason")}</TableHead>
                <TableHead className="text-right">{t("history.columns.change")}</TableHead>
                <TableHead className="text-right">{t("history.columns.after")}</TableHead>
                <TableHead>{t("history.columns.by")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {movements.map((movement) => {
                const reason = movement.reason as InventoryReason;
                return (
                  <TableRow key={movement.id}>
                    <TableCell className="whitespace-nowrap">
                      <LocalDateTime iso={movement.createdAt.toISOString()} locale={locale} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1">
                        <Badge variant={ORDER_REASONS.includes(reason) ? "outline" : "secondary"}>{t(`reasons.${reason}`)}</Badge>
                        {movement.orderId && movement.orderNumber !== null && (
                          <span className="text-xs text-muted-foreground">
                            {canOpenOrders ? (
                              <Link
                                href={storePath(storeId, `/orders/${movement.orderId}`)}
                                className="underline-offset-4 hover:underline"
                              >
                                {t("history.order", { number: orderReference(movement.orderNumber) })}
                              </Link>
                            ) : (
                              t("history.order", { number: orderReference(movement.orderNumber) })
                            )}
                          </span>
                        )}
                        {movement.unitCostMinor !== null && movement.costCurrencyCode && (
                          <span className="text-xs text-muted-foreground">
                            {t("history.unitCost", { cost: formatMoney(movement.unitCostMinor, movement.costCurrencyCode, locale) })}
                          </span>
                        )}
                        {movement.note && <span className="text-xs whitespace-pre-line text-muted-foreground">{movement.note}</span>}
                      </div>
                    </TableCell>
                    <TableCell
                      className={`text-right font-medium tabular-nums ${movement.delta < 0 ? "text-destructive" : ""}`}
                    >
                      {movement.delta > 0 ? `+${movement.delta.toLocaleString(locale)}` : movement.delta.toLocaleString(locale)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{movement.stockAfter.toLocaleString(locale)}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {/* a sale is placed by the customer at checkout */}
                      {movement.actorName ?? (reason === "sale" ? t("history.customer") : "—")}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>
    </div>
  );
}
