import { notFound } from "next/navigation";
import { ArrowLeftIcon, MessageCircleIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { orderReference, paymentTotals, type PaymentMethod } from "@/lib/orders";
import { storePath } from "@/lib/panel-paths";
import { receiptText } from "@/lib/pos";
import { LocalDateTime } from "@/components/local-date-time";
import { PrintButton } from "@/components/print-button";
import { buttonVariants } from "@/components/ui/button";
import { getOrder } from "@/server/orders";
import { receiptStore } from "@/server/pos";
import { requireMerchantPermission } from "@/server/tenant";

/**
 * An order's receipt, laid out for an 80 mm receipt printer (the browser's print dialog; the
 * panel around it is not printed). Also offers the same text by WhatsApp when the customer
 * gave a full international number.
 */
export default async function ReceiptPage({ params }: PageProps<"/[locale]/dashboard/store/[storeId]/orders/[id]/receipt">) {
  const { locale, storeId, id } = await params;
  setRequestLocale(locale);
  const merchant = await requireMerchantPermission(locale, storeId, { order: ["read"] });
  if (!z.uuid().safeParse(id).success) notFound();
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  const [placed, shop] = await Promise.all([getOrder(scope, id.toLowerCase()), receiptStore(scope)]);
  if (!placed || !shop) notFound();

  const t = await getTranslations("Receipt");
  const tm = await getTranslations("Orders.payments");
  const money = (minor: number) => formatMoney(minor, placed.currencyCode, locale);
  const items = placed.items.filter((item) => item.quantity > 0);
  const { net, due } = paymentTotals(placed.totalMinor, placed.payments);
  const seller = placed.channel === "pos" ? placed.history[0]?.actorName : null;
  const byMethod = placed.payments.reduce<Record<string, number>>((acc, p) => {
    acc[p.method] = (acc[p.method] ?? 0) + (p.kind === "refund" ? -p.amountMinor : p.amountMinor);
    return acc;
  }, {});

  const text = receiptText({
    store: shop.name,
    reference: t("order", { number: orderReference(placed.number) }),
    lines: items.map((item) => ({
      name: item.variantTitle ? `${item.productName} (${item.variantTitle})` : item.productName,
      quantity: item.quantity,
      total: money(item.lineTotalMinor),
    })),
    total: `${t("total")}: ${money(placed.totalMinor)}`,
  });
  // wa.me wants the number with its country code and no "+"
  const whatsapp = placed.customerPhone.startsWith("+")
    ? `https://wa.me/${placed.customerPhone.slice(1)}?text=${encodeURIComponent(text)}`
    : null;

  return (
    <div className="flex flex-1 flex-col items-center gap-4 p-4 print:block print:p-0">
      {/* 80 mm paper: no page margins of the browser's own, the receipt sets its width */}
      <style>{`@media print { @page { size: 80mm auto; margin: 0; } }`}</style>
      <div className="flex w-full max-w-sm flex-wrap items-center justify-between gap-2 print:hidden">
        <Link href={storePath(storeId, `/orders/${placed.id}`)} className={buttonVariants({ variant: "ghost", size: "sm" })}>
          <ArrowLeftIcon />
          {t("back")}
        </Link>
        <div className="flex gap-2">
          {whatsapp && (
            <a href={whatsapp} target="_blank" rel="noreferrer" className={buttonVariants({ variant: "outline", size: "sm" })}>
              <MessageCircleIcon />
              WhatsApp
            </a>
          )}
          <PrintButton label={t("print")} autoFocus />
        </div>
      </div>

      <article className="w-[80mm] max-w-full rounded-md border bg-white p-4 font-mono text-xs leading-relaxed text-black print:w-[80mm] print:rounded-none print:border-0 print:p-3">
        <header className="flex flex-col items-center gap-0.5 text-center">
          <p className="text-sm font-bold">{shop.name}</p>
          {shop.address && <p className="whitespace-pre-line">{shop.address}</p>}
          {shop.phone && <p>{shop.phone}</p>}
        </header>
        <hr className="my-2 border-dashed border-black" />
        <p>{t("order", { number: orderReference(placed.number) })}</p>
        <p>
          <LocalDateTime iso={placed.createdAt.toISOString()} locale={locale} />
        </p>
        {seller && <p>{t("seller", { name: seller })}</p>}
        {placed.customerName && <p>{t("customer", { name: placed.customerName })}</p>}
        <hr className="my-2 border-dashed border-black" />
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.id}>
              <p>
                {item.productName}
                {item.variantTitle && ` (${item.variantTitle})`}
              </p>
              <p className="flex justify-between gap-2 tabular-nums">
                <span>
                  {item.quantity} x {money(item.unitPriceMinor)}
                </span>
                <span>{money(item.lineTotalMinor)}</span>
              </p>
            </li>
          ))}
        </ul>
        <hr className="my-2 border-dashed border-black" />
        {placed.deliveryFeeMinor > 0 && (
          <p className="flex justify-between gap-2 tabular-nums">
            <span>{t("delivery")}</span>
            <span>{money(placed.deliveryFeeMinor)}</span>
          </p>
        )}
        <p className="flex justify-between gap-2 text-sm font-bold tabular-nums">
          <span>{t("total")}</span>
          <span>{money(placed.totalMinor)}</span>
        </p>
        {Object.entries(byMethod)
          .filter(([, amount]) => amount !== 0)
          .map(([method, amount]) => (
            <p key={method} className="flex justify-between gap-2 tabular-nums">
              <span>{tm(`method.${method as PaymentMethod}`)}</span>
              <span>{money(amount)}</span>
            </p>
          ))}
        {due > 0 && (
          <p className="flex justify-between gap-2 font-bold tabular-nums">
            <span>{net > 0 ? t("due") : t("unpaid")}</span>
            <span>{money(due)}</span>
          </p>
        )}
        <hr className="my-2 border-dashed border-black" />
        <p className="text-center">{t("thanks")}</p>
      </article>
    </div>
  );
}
