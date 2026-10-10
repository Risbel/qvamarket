import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUSES, isOrderStatus, orderReference, orderStatusVariant, paymentStatusVariant } from "@/lib/orders";
import { cn } from "@/lib/utils";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ORDERS_PAGE_SIZE, countOrdersByStatus, listOrders } from "@/server/orders";
import { requireMerchantPermission } from "@/server/tenant";

export default async function OrdersPage({ params, searchParams }: PageProps<"/[locale]/dashboard/orders">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, { order: ["read"] });
  const t = await getTranslations("Orders");
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };

  // Filters come from the URL (shareable, back button works); anything unexpected is ignored
  const search = await searchParams;
  const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? "";
  const status = isOrderStatus(one(search.status)) ? (one(search.status) as (typeof ORDER_STATUSES)[number]) : null;
  const query = one(search.q).slice(0, 100);
  const page = Math.min(Math.max(Number.parseInt(one(search.page), 10) || 1, 1), 10_000);

  const [{ orders, total }, counts] = await Promise.all([
    listOrders(scope, { status, query, page }),
    countOrdersByStatus(scope),
  ]);
  const all = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const pages = Math.max(1, Math.ceil(total / ORDERS_PAGE_SIZE));
  const href = (changes: { status?: string | null; page?: number }) => {
    const next = { status: changes.status !== undefined ? changes.status : status, q: query, page: changes.page ?? 1 };
    return {
      pathname: "/dashboard/orders",
      query: Object.fromEntries(
        Object.entries(next).filter(([key, value]) => value && !(key === "page" && value === 1)),
      ) as Record<string, string>,
    };
  };

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      <nav aria-label={t("filters.label")} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {[null, ...ORDER_STATUSES].map((key) => {
          const active = key === status;
          const n = key ? (counts[key] ?? 0) : all;
          return (
            <Link
              key={key ?? "all"}
              href={href({ status: key })}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm whitespace-nowrap hover:bg-muted",
                active && "border-foreground bg-muted font-medium",
              )}
            >
              {key ? t(`status.${key}`) : t("filters.all")}
              <span className="text-muted-foreground tabular-nums">{n}</span>
            </Link>
          );
        })}
      </nav>

      {/* A GET search form on purpose: the search belongs in the URL and holds nothing private */}
      <form method="get" role="search" className="flex gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <Input
          name="q"
          type="search"
          defaultValue={query}
          placeholder={t("search.placeholder")}
          aria-label={t("search.label")}
          className="max-w-sm"
        />
        <button type="submit" className={buttonVariants({ variant: "outline" })}>
          {t("search.submit")}
        </button>
      </form>

      {orders.length === 0 ? (
        <p className="text-muted-foreground">{all === 0 ? t("empty") : t("noMatches")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("columns.number")}</TableHead>
              <TableHead>{t("columns.date")}</TableHead>
              <TableHead>{t("columns.customer")}</TableHead>
              <TableHead className="text-right">{t("columns.units")}</TableHead>
              <TableHead className="text-right">{t("columns.total")}</TableHead>
              <TableHead>{t("columns.status")}</TableHead>
              <TableHead>{t("columns.payment")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((o) => (
              <TableRow key={o.id}>
                <TableCell className="font-medium">
                  <Link href={`/dashboard/orders/${o.id}`} className="underline-offset-4 hover:underline">
                    {orderReference(o.number)}
                  </Link>
                </TableCell>
                <TableCell className="text-muted-foreground">
                  <LocalDateTime iso={o.createdAt.toISOString()} locale={locale} />
                </TableCell>
                <TableCell>
                  <div>{o.customerName}</div>
                  <div className="text-sm text-muted-foreground">{o.customerPhone}</div>
                </TableCell>
                <TableCell className="text-right tabular-nums">{o.units}</TableCell>
                <TableCell className="text-right tabular-nums">{formatMoney(o.totalMinor, o.currencyCode, locale)}</TableCell>
                <TableCell>
                  <Badge variant={orderStatusVariant(o.status)}>{t(`status.${o.status as (typeof ORDER_STATUSES)[number]}`)}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant={paymentStatusVariant(o.paymentStatus)}>
                    {t(`payment.${o.paymentStatus as "unpaid" | "partial" | "paid" | "refunded"}`)}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      {pages > 1 && (
        <nav aria-label={t("pagination.label")} className="flex items-center justify-between gap-4 text-sm">
          {page > 1 ? (
            <Link href={href({ page: page - 1 })} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("pagination.previous")}
            </Link>
          ) : (
            <span />
          )}
          <span className="text-muted-foreground">{t("pagination.page", { page, pages })}</span>
          {page < pages ? (
            <Link href={href({ page: page + 1 })} className={buttonVariants({ variant: "outline", size: "sm" })}>
              {t("pagination.next")}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </div>
  );
}
