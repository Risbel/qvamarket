import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { formatMoney } from "@/lib/money";
import { orderReference, orderStatusVariant, type OrderStatus } from "@/lib/orders";
import { ACCOUNT_ORDERS_LIMIT, ensureCustomer, listAccountOrders } from "@/server/customer-accounts";
import { getPublicStoreBySlug } from "@/server/public-store";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";

export async function generateMetadata() {
  const t = await getTranslations("Store.account.orders");
  return { title: t("title"), robots: { index: false } };
}

/** The orders the shopper placed on this store while signed in. */
export default async function AccountOrdersPage({ params }: PageProps<"/[locale]/stores/[slug]/account/orders">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const store = await getPublicStoreBySlug(slug);
  if (!store) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return redirect({ href: { pathname: "/login", query: { next: "/account/orders" } }, locale });
  // Covers a session started without our sign-in (e.g. Better Auth's own endpoint)
  await ensureCustomer(store.id, session.user);

  const t = await getTranslations("Store.account");
  const tStatus = await getTranslations("Orders.status");
  const orders = await listAccountOrders(store.id, session.user.id);
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("orders.title")}</h1>
      <section className="flex flex-col gap-3">
        {orders.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("orders.empty")}</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border">
            {orders.map((placed) => (
              <li key={placed.id}>
                <Link href={`/orders/${placed.id}`} className="flex items-center justify-between gap-3 p-3 hover:bg-muted/50">
                  <span className="min-w-0">
                    <span className="block font-medium">{t("orders.number", { number: orderReference(placed.number) })}</span>
                    <span className="block text-xs text-muted-foreground">
                      <LocalDateTime iso={placed.createdAt.toISOString()} locale={locale} />
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    <span className="tabular-nums">{formatMoney(placed.totalMinor, placed.currencyCode, locale)}</span>
                    <Badge variant={orderStatusVariant(placed.status)}>{tStatus(placed.status as OrderStatus)}</Badge>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {orders.length === ACCOUNT_ORDERS_LIMIT && (
          <p className="text-xs text-muted-foreground">{t("orders.limited", { count: ACCOUNT_ORDERS_LIMIT })}</p>
        )}
        <p className="text-xs text-muted-foreground">{t("orders.signedInOnly")}</p>
      </section>
      <Link href="/" className="w-fit text-sm font-medium underline underline-offset-4">
        {t("continueShopping")}
      </Link>
    </main>
  );
}
