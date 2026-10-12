import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { orderReference, orderStatusVariant, paymentStatusVariant, type OrderStatus, type PaymentStatus } from "@/lib/orders";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOrder } from "@/server/orders";
import { requireMerchantPermission } from "@/server/tenant";
import { PaymentsSection } from "./payments-section";
import { StatusActions } from "./status-actions";

export default async function OrderPage({ params }: PageProps<"/[locale]/dashboard/orders/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { order: ["read"] });
  if (!z.uuid().safeParse(id).success) notFound();
  const placed = await getOrder({ tenantId: merchant.tenantId, storeId: merchant.store.id }, id.toLowerCase());
  if (!placed) notFound();

  const t = await getTranslations("Orders");
  const canUpdate = merchant.can({ order: ["update"] });
  const money = (minor: number) => formatMoney(minor, placed.currencyCode, locale);
  const status = (value: string) => t(`status.${value as OrderStatus}`);
  // wa.me wants the number with its country code and no "+"; only offered for a full number
  const whatsapp = placed.customerPhone.startsWith("+") ? `https://wa.me/${placed.customerPhone.slice(1)}` : null;

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4">
      <div className="flex flex-col gap-2">
        <Link href="/dashboard/orders" className="w-fit text-sm text-muted-foreground hover:underline">
          ← {t("back")}
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{t("detail.title", { number: orderReference(placed.number) })}</h1>
          <Badge variant={orderStatusVariant(placed.status)}>{status(placed.status)}</Badge>
          <Badge variant={paymentStatusVariant(placed.paymentStatus)}>
            {t(`payment.${placed.paymentStatus as PaymentStatus}`)}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          <LocalDateTime iso={placed.createdAt.toISOString()} locale={locale} /> ·{" "}
          {t(`fulfillment.${placed.fulfillmentType as "pickup" | "delivery"}`)}
        </p>
        {canUpdate && (
          <StatusActions
            orderId={placed.id}
            reference={orderReference(placed.number)}
            status={placed.status as OrderStatus}
            fulfillmentType={placed.fulfillmentType}
          />
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem] md:items-start">
        <section className="flex min-w-0 flex-col gap-3" aria-labelledby="items-title">
          <h2 id="items-title" className="text-lg font-semibold">
            {t("detail.items")}
          </h2>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("detail.product")}</TableHead>
                <TableHead className="text-right">{t("detail.quantity")}</TableHead>
                <TableHead className="text-right">{t("detail.unitPrice")}</TableHead>
                <TableHead className="text-right">{t("detail.lineTotal")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {placed.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-normal">
                    <div className="font-medium">{item.productName}</div>
                    {item.variantTitle && <div className="text-sm text-muted-foreground">{item.variantTitle}</div>}
                    {item.sku && <div className="text-xs text-muted-foreground">{t("detail.sku", { sku: item.sku })}</div>}
                    {item.productId === null && (
                      <div className="text-xs text-muted-foreground">{t("detail.productDeleted")}</div>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{item.quantity}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(item.unitPriceMinor)}
                    {item.compareAtMinor !== null && (
                      <s className="block text-xs text-muted-foreground">{money(item.compareAtMinor)}</s>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{money(item.lineTotalMinor)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
            <TableFooter>
              <TableRow>
                <TableCell colSpan={3}>{t("detail.subtotal")}</TableCell>
                <TableCell className="text-right tabular-nums">{money(placed.subtotalMinor)}</TableCell>
              </TableRow>
              {placed.deliveryFeeMinor > 0 && (
                <TableRow>
                  <TableCell colSpan={3}>{t("detail.deliveryFee")}</TableCell>
                  <TableCell className="text-right tabular-nums">{money(placed.deliveryFeeMinor)}</TableCell>
                </TableRow>
              )}
              <TableRow className="font-semibold">
                <TableCell colSpan={3}>{t("detail.total")}</TableCell>
                <TableCell className="text-right tabular-nums">{money(placed.totalMinor)}</TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </section>

        <div className="flex flex-col gap-6">
          <section className="flex flex-col gap-1 rounded-lg border p-4 text-sm" aria-labelledby="customer-title">
            <h2 id="customer-title" className="mb-1 font-semibold">
              {t("detail.customer")}
            </h2>
            <p className="font-medium">{placed.customerName}</p>
            <p>
              <a href={`tel:${placed.customerPhone}`} className="underline-offset-4 hover:underline">
                {placed.customerPhone}
              </a>
              {whatsapp && (
                <>
                  {" · "}
                  <a href={whatsapp} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                    WhatsApp
                  </a>
                </>
              )}
            </p>
            {placed.customerEmail && (
              <p>
                <a href={`mailto:${placed.customerEmail}`} className="break-all underline-offset-4 hover:underline">
                  {placed.customerEmail}
                </a>
              </p>
            )}
            {placed.customerNote && (
              <div className="mt-2">
                <p className="text-muted-foreground">{t("detail.note")}</p>
                <p className="whitespace-pre-line">{placed.customerNote}</p>
              </div>
            )}
          </section>

          <PaymentsSection
            orderId={placed.id}
            currency={placed.currencyCode}
            totalMinor={placed.totalMinor}
            cancelled={placed.status === "cancelled"}
            canUpdate={canUpdate}
            payments={placed.payments.map((p) => ({ ...p, paidAt: p.paidAt.toISOString() }))}
          />

          <section className="flex flex-col gap-2 rounded-lg border p-4 text-sm" aria-labelledby="history-title">
            <h2 id="history-title" className="font-semibold">
              {t("detail.history")}
            </h2>
            <ol className="flex flex-col gap-2">
              {placed.history.map((h) => (
                <li key={h.id}>
                  <span className="font-medium">
                    {h.fromStatus ? t("detail.changed", { from: status(h.fromStatus), to: status(h.toStatus) }) : t("detail.placed")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    <LocalDateTime iso={h.createdAt.toISOString()} locale={locale} /> ·{" "}
                    {h.actorName ?? t(`detail.actor.${h.actor as "customer" | "merchant" | "system"}`)}
                  </span>
                  {h.note && <span className="block whitespace-pre-line">{h.note}</span>}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}
