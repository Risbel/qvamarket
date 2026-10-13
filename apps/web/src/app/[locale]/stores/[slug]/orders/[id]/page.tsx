import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { getPublicOrder } from "@/server/checkout";
import { getPublicStoreBySlug } from "@/server/public-store";

export async function generateMetadata() {
  const t = await getTranslations("Store.order");
  return { title: t("title"), robots: { index: false } };
}

/**
 * Confirmation shown right after checkout. The order id (random UUID) in the URL is the key;
 * the order must belong to this store. It shows what was ordered, not its progress (an order
 * tracking page is in the Parking Lot).
 */
export default async function OrderConfirmationPage({ params }: PageProps<"/[locale]/stores/[slug]/orders/[id]">) {
  const { locale, slug, id } = await params;
  setRequestLocale(locale);
  if (!z.uuid().safeParse(id).success) notFound();

  const store = await getPublicStoreBySlug(slug);
  if (!store) notFound();
  const placed = await getPublicOrder(store.id, id.toLowerCase());
  if (!placed) notFound();

  const t = await getTranslations("Store.order");
  const money = (minor: number) => formatMoney(minor, placed.currencyCode, locale);
  const session = placed.userId ? await auth.api.getSession({ headers: await headers() }) : null;
  const mine = session?.user.id === placed.userId;

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-4 py-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-lg">{t("number", { number: placed.number })}</p>
        <p className="text-muted-foreground">{t("intro", { store: store.name })}</p>
      </div>

      <section className="flex flex-col gap-2 rounded-lg border p-4" aria-labelledby="fulfillment-title">
        <h2 id="fulfillment-title" className="font-semibold">
          {placed.delivery ? t("delivery") : t("pickup")}
        </h2>
        {placed.delivery ? (
          <p className="text-sm whitespace-pre-line">{placed.delivery.address}</p>
        ) : (
          <>
            {store.address && <p className="text-sm whitespace-pre-line">{store.address}</p>}
            {store.pickupInstructions && (
              <p className="text-sm whitespace-pre-line text-muted-foreground">{store.pickupInstructions}</p>
            )}
          </>
        )}
        <p className="text-sm text-muted-foreground">{t("payment")}</p>
        {(store.phone || store.whatsapp) && (
          <p className="text-sm">
            {t("contactStore")}{" "}
            {[store.phone, store.whatsapp && `WhatsApp ${store.whatsapp}`].filter(Boolean).join(" · ")}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border p-4" aria-labelledby="items-title">
        <h2 id="items-title" className="font-semibold">
          {t("items")}
        </h2>
        <ul className="flex flex-col gap-3">
          {placed.items.map((item) => (
            <li key={item.id} className="flex justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">{item.productName}</span>
                {item.variantTitle && <span className="block text-muted-foreground">{item.variantTitle}</span>}
                <span className="block text-muted-foreground">
                  {item.quantity} × {money(item.unitPriceMinor)}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{money(item.lineTotalMinor)}</span>
            </li>
          ))}
        </ul>
        {placed.delivery && (
          <div className="flex flex-col gap-1 border-t pt-3 text-sm">
            <div className="flex justify-between">
              <span>{t("subtotal")}</span>
              <span className="tabular-nums">{money(placed.subtotalMinor)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t("deliveryFee")}</span>
              <span className="tabular-nums">{placed.deliveryFeeMinor === 0 ? t("free") : money(placed.deliveryFeeMinor)}</span>
            </div>
          </div>
        )}
        <div className="flex justify-between border-t pt-3 font-semibold">
          <span>{t("total")}</span>
          <span className="tabular-nums">{money(placed.totalMinor)}</span>
        </div>
      </section>

      <section className="flex flex-col gap-1 rounded-lg border p-4 text-sm" aria-labelledby="contact-title">
        <h2 id="contact-title" className="mb-1 font-semibold">
          {t("yourDetails")}
        </h2>
        <p>{placed.customerName}</p>
        <p>{placed.customerPhone}</p>
        {placed.customerEmail && <p>{placed.customerEmail}</p>}
        {placed.customerNote && <p className="whitespace-pre-line text-muted-foreground">{placed.customerNote}</p>}
      </section>

      <div className="flex flex-wrap gap-4">
        {mine && (
          <Link href="/account" className="w-fit text-sm font-medium underline underline-offset-4">
            {t("myOrders")}
          </Link>
        )}
        <Link href="/" className="w-fit text-sm font-medium underline underline-offset-4">
          {t("continueShopping")}
        </Link>
      </div>
    </main>
  );
}
