import { storePath } from "@/lib/panel-paths";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, MailIcon, MessageCircleIcon, PhoneIcon, Truck } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { CUSTOMER_ORDERS_MAX } from "@/lib/customer-list";
import { formatMoney } from "@/lib/money";
import {
  orderReference,
  orderStatusVariant,
  paymentStatusVariant,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/orders";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getCustomer } from "@/server/customers";
import { requirePanelSection } from "@/server/tenant";

export default async function CustomerPage({ params }: PageProps<"/[locale]/dashboard/store/[storeId]/customers/[id]">) {
  const { locale, storeId, id } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, storeId, "customers");
  if (!z.uuid().safeParse(id).success) notFound();
  // Another company's customer, or one who never ordered in this store, is a 404
  const found = await getCustomer({ tenantId: merchant.tenantId, storeId: merchant.store.id }, id.toLowerCase());
  if (!found) notFound();

  const t = await getTranslations("Customers");
  const tOrders = await getTranslations("Orders");
  const canOpenOrders = merchant.can({ order: ["read"] });
  // wa.me wants the number with its country code and no "+"; only offered for a full number
  const whatsapp = found.phone?.startsWith("+") ? `https://wa.me/${found.phone.slice(1)}` : null;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
      <div className="flex flex-col gap-3">
        <Link
          href={storePath(storeId, "/customers")}
          className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2 w-fit" })}
        >
          <ArrowLeftIcon />
          {t("back")}
        </Link>
        <div className="flex flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{found.name}</h1>
            <Badge variant={found.hasAccount ? "secondary" : "outline"}>{found.hasAccount ? t("account") : t("guest")}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {t("detail.since")} <LocalDateTime iso={found.createdAt.toISOString()} locale={locale} />
          </p>
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem] md:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-3">
            <Card size="sm">
              <CardHeader>
                <CardDescription>{t("detail.orders")}</CardDescription>
                <CardTitle className="text-2xl tabular-nums">{found.orders}</CardTitle>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>{t("detail.spent")}</CardDescription>
                {/* amounts are never added across currencies: one line each */}
                <CardTitle className="flex flex-col text-2xl tabular-nums">
                  {found.spent.length
                    ? found.spent.map((amount) => (
                        <span key={amount.currencyCode}>{formatMoney(amount.amountMinor, amount.currencyCode, locale)}</span>
                      ))
                    : "—"}
                </CardTitle>
                <p className="text-xs text-muted-foreground">{t("detail.spentHint")}</p>
              </CardHeader>
            </Card>
            <Card size="sm">
              <CardHeader>
                <CardDescription>{t("detail.lastOrder")}</CardDescription>
                <CardTitle className="text-base">
                  <LocalDateTime iso={found.lastOrderAt.toISOString()} locale={locale} />
                </CardTitle>
              </CardHeader>
            </Card>
          </div>

          <Card role="region" aria-labelledby="orders-title">
            <CardHeader>
              <CardTitle>
                <h2 id="orders-title">{t("detail.orderList")}</h2>
              </CardTitle>
              {found.orders > CUSTOMER_ORDERS_MAX && (
                <CardDescription>{t("detail.ordersLimited", { max: CUSTOMER_ORDERS_MAX })}</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{tOrders("columns.number")}</TableHead>
                    <TableHead>{tOrders("columns.date")}</TableHead>
                    <TableHead>{tOrders("columns.status")}</TableHead>
                    <TableHead>{tOrders("columns.payment")}</TableHead>
                    <TableHead className="text-right">{tOrders("columns.total")}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {found.orderList.map((o) => (
                    <TableRow key={o.id}>
                      <TableCell className="font-medium whitespace-nowrap">
                        {canOpenOrders ? (
                          <Link href={storePath(storeId, `/orders/${o.id}`)} className="underline-offset-4 hover:underline">
                            {orderReference(o.number)}
                          </Link>
                        ) : (
                          orderReference(o.number)
                        )}
                        {o.fulfillmentType === "delivery" && (
                          <span
                            title={tOrders("fulfillment.delivery")}
                            className="ml-1.5 inline-flex align-text-bottom text-muted-foreground"
                          >
                            <Truck className="size-4" aria-hidden />
                            <span className="sr-only">{tOrders("fulfillment.delivery")}</span>
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        <LocalDateTime iso={o.createdAt.toISOString()} locale={locale} />
                      </TableCell>
                      <TableCell>
                        <Badge variant={orderStatusVariant(o.status)}>{tOrders(`status.${o.status as OrderStatus}`)}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={paymentStatusVariant(o.paymentStatus)}>
                          {tOrders(`payment.${o.paymentStatus as PaymentStatus}`)}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatMoney(o.totalMinor, o.currencyCode, locale)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <Card role="region" aria-labelledby="contact-title">
          <CardHeader>
            <CardTitle>
              <h2 id="contact-title">{t("detail.contact")}</h2>
            </CardTitle>
            <CardDescription>{found.hasAccount ? t("detail.accountHint") : t("detail.guestHint")}</CardDescription>
          </CardHeader>
          <CardContent>
            {found.phone || found.email ? (
              <ul className="flex flex-col gap-2">
                {found.phone && (
                  <li className="flex items-center gap-2">
                    <PhoneIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <a href={`tel:${found.phone}`} className="tabular-nums underline-offset-4 hover:underline">
                      {found.phone}
                    </a>
                  </li>
                )}
                {whatsapp && (
                  <li className="flex items-center gap-2">
                    <MessageCircleIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <a href={whatsapp} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                      WhatsApp
                    </a>
                  </li>
                )}
                {found.email && (
                  <li className="flex items-center gap-2">
                    <MailIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <a href={`mailto:${found.email}`} className="min-w-0 break-all underline-offset-4 hover:underline">
                      {found.email}
                    </a>
                  </li>
                )}
              </ul>
            ) : (
              <p className="text-muted-foreground">{t("detail.noContact")}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
