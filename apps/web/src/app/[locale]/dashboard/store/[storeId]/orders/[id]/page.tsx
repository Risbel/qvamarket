import { storePath } from "@/lib/panel-paths";
import { notFound } from "next/navigation";
import { ArrowLeftIcon, ExternalLinkIcon, MailIcon, MapPinIcon, MessageCircleIcon, PhoneIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { PANEL_ACCESS } from "@/lib/panel-access";
import {
  canEditItems,
  orderReference,
  orderStatusVariant,
  paymentMethodsOf,
  paymentStatusVariant,
  paymentTotals,
  type OrderStatus,
  type PaymentStatus,
} from "@/lib/orders";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getOrder } from "@/server/orders";
import { requireMerchantPermission } from "@/server/tenant";
import { EditItemsDialog } from "./edit-items-dialog";
import { OrderLocationMap } from "./order-location-map";
import { PaymentsSection } from "./payments-section";
import { hasOpenShift } from "@/server/register";
import { StatusActions } from "./status-actions";

export default async function OrderPage({ params }: PageProps<"/[locale]/dashboard/store/[storeId]/orders/[id]">) {
  const { locale, storeId, id } = await params;
  setRequestLocale(locale);

  const merchant = await requireMerchantPermission(locale, storeId, { order: ["read"] });
  if (!z.uuid().safeParse(id).success) notFound();
  const placed = await getOrder({ tenantId: merchant.tenantId, storeId: merchant.store.id }, id.toLowerCase());
  if (!placed) notFound();

  const t = await getTranslations("Orders");
  const canChangeStatus = merchant.can({ order: ["update"] }) || merchant.can({ order: ["cancel"] });
  const canSeePayments = merchant.can({ payment: ["read"] });
  // someone who runs a register but has no open shift: the cash they record goes to no drawer
  const noShift =
    merchant.can({ payment: ["create"], register: ["create"] }) &&
    !(await hasOpenShift({ tenantId: merchant.tenantId, storeId: merchant.store.id }, merchant.session.user.id));
  // the customer record the order is grouped under (null if that record was deleted)
  const customerHref =
    placed.customerId && merchant.can(PANEL_ACCESS.customers) ? storePath(storeId, `/customers/${placed.customerId}`) : null;
  const canEdit = merchant.can({ order: ["edit"] }) && canEditItems(placed.status);
  const money = (minor: number) => formatMoney(minor, placed.currencyCode, locale);
  const status = (value: string) => t(`status.${value as OrderStatus}`);
  // wa.me wants the number with its country code and no "+"; only offered for a full number
  const whatsapp = placed.customerPhone.startsWith("+") ? `https://wa.me/${placed.customerPhone.slice(1)}` : null;
  const delivery = placed.delivery;
  // The pin as text for the courier's own map app (6 decimals = about 10 cm)
  const coordinates = delivery ? `${delivery.lat.toFixed(6)},${delivery.lng.toFixed(6)}` : null;
  const units = placed.items.reduce((sum, item) => sum + item.quantity, 0);
  const deliveryFee = placed.deliveryFeeMinor === 0 ? t("detail.delivery.free") : money(placed.deliveryFeeMinor);
  // Status changes and item edits in one timeline, oldest first
  const timeline = [
    ...placed.history.map((entry) => ({ kind: "status" as const, ...entry })),
    ...placed.edits.map((entry) => ({ kind: "edit" as const, ...entry })),
  ].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4">
      <div className="flex flex-col gap-3">
        <Link href={storePath(storeId, "/orders")} className={buttonVariants({ variant: "ghost", size: "sm", className: "-ml-2 w-fit" })}>
          <ArrowLeftIcon />
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold">{t("detail.title", { number: orderReference(placed.number) })}</h1>
              <Badge variant={orderStatusVariant(placed.status)}>{status(placed.status)}</Badge>
              <Badge variant={paymentStatusVariant(placed.paymentStatus)}>
                {t(`payment.${placed.paymentStatus as PaymentStatus}`)}
              </Badge>
              {canSeePayments &&
                paymentMethodsOf(placed.payments).map((method) => (
                  <Badge key={method} variant="outline">
                    {t(`payments.method.${method}`)}
                  </Badge>
                ))}
            </div>
            <p className="text-sm text-muted-foreground">
              <LocalDateTime iso={placed.createdAt.toISOString()} locale={locale} /> ·{" "}
              {t(`fulfillment.${placed.fulfillmentType as "pickup" | "delivery"}`)}
            </p>
          </div>
          {canChangeStatus && (
            <StatusActions
              orderId={placed.id}
              reference={orderReference(placed.number)}
              status={placed.status as OrderStatus}
              fulfillmentType={placed.fulfillmentType}
            />
          )}
        </div>
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem] md:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          <Card role="region" aria-labelledby="items-title">
            <CardHeader>
              <CardTitle>
                <h2 id="items-title">{t("detail.items")}</h2>
              </CardTitle>
              <CardDescription>{t("detail.itemCount", { count: units })}</CardDescription>
              {canEdit && (
                <CardAction>
                  <EditItemsDialog
                    orderId={placed.id}
                    reference={orderReference(placed.number)}
                    currency={placed.currencyCode}
                    deliveryFeeMinor={placed.deliveryFeeMinor}
                    collectedMinor={canSeePayments ? paymentTotals(placed.totalMinor, placed.payments).net : null}
                    items={placed.items.filter((item) => item.quantity > 0)}
                  />
                </CardAction>
              )}
            </CardHeader>
            <CardContent>
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
                    <TableRow key={item.id} className={item.quantity === 0 ? "text-muted-foreground" : undefined}>
                      <TableCell className="whitespace-normal">
                        <div className={item.quantity === 0 ? "font-medium line-through" : "font-medium"}>{item.productName}</div>
                        {item.variantTitle && <div className="text-sm text-muted-foreground">{item.variantTitle}</div>}
                        {item.sku && <div className="text-xs text-muted-foreground">{t("detail.sku", { sku: item.sku })}</div>}
                        {item.productId === null && (
                          <div className="text-xs text-muted-foreground italic">{t("detail.productDeleted")}</div>
                        )}
                        {item.originalQuantity !== null && (
                          <Badge variant="outline" className="mt-1">
                            {item.quantity === 0 ? t("detail.removed") : t("detail.lowered")}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.originalQuantity !== null && (
                          <s className="mr-1.5 text-muted-foreground">
                            <span className="sr-only">{t("detail.originalQuantity")}</span>
                            {item.originalQuantity}
                          </s>
                        )}
                        {item.quantity}
                      </TableCell>
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
                  {(placed.fulfillmentType === "delivery" || placed.deliveryFeeMinor > 0) && (
                    <TableRow>
                      <TableCell colSpan={3}>{t("detail.deliveryFee")}</TableCell>
                      <TableCell className="text-right tabular-nums">{deliveryFee}</TableCell>
                    </TableRow>
                  )}
                  <TableRow className="text-base font-semibold">
                    <TableCell colSpan={3}>{t("detail.total")}</TableCell>
                    <TableCell className="text-right tabular-nums">{money(placed.totalMinor)}</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </CardContent>
          </Card>

          {delivery && coordinates && (
            <Card role="region" aria-labelledby="delivery-title">
              <CardHeader>
                <CardTitle>
                  <h2 id="delivery-title">{t("detail.delivery.title")}</h2>
                </CardTitle>
                <CardDescription>
                  {t("detail.delivery.distance", { km: (delivery.distanceM / 1000).toFixed(1) })}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <div className="flex items-start gap-2">
                  <MapPinIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <p className="whitespace-pre-line">{delivery.address}</p>
                </div>
                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                  <dt className="text-muted-foreground">{t("detail.deliveryFee")}</dt>
                  <dd>
                    {deliveryFee} · {t(`detail.delivery.mode.${delivery.feeMode as "free" | "flat" | "distance"}`)}
                  </dd>
                  <dt className="text-muted-foreground">{t("detail.delivery.coordinates")}</dt>
                  <dd className="select-all tabular-nums">{coordinates}</dd>
                </dl>
                <OrderLocationMap
                  location={{ lat: delivery.lat, lng: delivery.lng }}
                  locale={locale}
                  labels={{
                    map: t("detail.delivery.mapLabel"),
                    error: t("detail.delivery.mapError"),
                    unavailable: t("detail.delivery.tilesUnavailable"),
                  }}
                />
              </CardContent>
              <CardFooter className="flex-wrap gap-2">
                <span className="text-muted-foreground">{t("detail.delivery.openIn")}</span>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${coordinates}`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  Google Maps
                  <ExternalLinkIcon />
                </a>
                <a
                  href={`https://www.openstreetmap.org/?mlat=${delivery.lat.toFixed(6)}&mlon=${delivery.lng.toFixed(6)}#map=18/${delivery.lat.toFixed(6)}/${delivery.lng.toFixed(6)}`}
                  target="_blank"
                  rel="noreferrer"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                >
                  OpenStreetMap
                  <ExternalLinkIcon />
                </a>
              </CardFooter>
            </Card>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card role="region" aria-labelledby="customer-title">
            <CardHeader>
              <CardTitle>
                <h2 id="customer-title">{t("detail.customer")}</h2>
              </CardTitle>
              <CardDescription className="font-medium text-foreground">{placed.customerName}</CardDescription>
              {customerHref && (
                <CardAction>
                  <Link href={customerHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    {t("detail.viewCustomer")}
                  </Link>
                </CardAction>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ul className="flex flex-col gap-2">
                <li className="flex items-center gap-2">
                  <PhoneIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <a href={`tel:${placed.customerPhone}`} className="tabular-nums underline-offset-4 hover:underline">
                    {placed.customerPhone}
                  </a>
                </li>
                {whatsapp && (
                  <li className="flex items-center gap-2">
                    <MessageCircleIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <a href={whatsapp} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
                      WhatsApp
                    </a>
                  </li>
                )}
                {placed.customerEmail && (
                  <li className="flex items-center gap-2">
                    <MailIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <a href={`mailto:${placed.customerEmail}`} className="min-w-0 break-all underline-offset-4 hover:underline">
                      {placed.customerEmail}
                    </a>
                  </li>
                )}
              </ul>
              {placed.customerNote && (
                <div className="flex flex-col gap-1 rounded-lg bg-muted p-3">
                  <p className="text-xs font-medium text-muted-foreground">{t("detail.note")}</p>
                  <p className="whitespace-pre-line">{placed.customerNote}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {canSeePayments && (
            <PaymentsSection
              orderId={placed.id}
              currency={placed.currencyCode}
              totalMinor={placed.totalMinor}
              cancelled={placed.status === "cancelled"}
              payments={placed.payments.map((p) => ({ ...p, paidAt: p.paidAt.toISOString() }))}
              noShift={noShift}
            />
          )}

          <Card role="region" aria-labelledby="history-title">
            <CardHeader>
              <CardTitle>
                <h2 id="history-title">{t("detail.history")}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col">
                {timeline.map((h, index) => (
                  <li key={h.id} className="relative flex gap-3 pb-4 last:pb-0">
                    {/* the line joining this step to the next one */}
                    {index < timeline.length - 1 && (
                      <Separator orientation="vertical" className="absolute top-4 bottom-0 left-[3.5px]" />
                    )}
                    <span
                      className={
                        index === timeline.length - 1
                          ? "mt-1.5 size-2 shrink-0 rounded-full bg-primary"
                          : "mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground/40"
                      }
                      aria-hidden
                    />
                    <div className="flex min-w-0 flex-col gap-0.5">
                      <span className="font-medium">
                        {h.kind === "edit"
                          ? t("detail.edited")
                          : h.fromStatus
                            ? t("detail.changed", { from: status(h.fromStatus), to: status(h.toStatus) })
                            : t("detail.placed")}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        <LocalDateTime iso={h.createdAt.toISOString()} locale={locale} /> ·{" "}
                        {h.actorName ??
                          t(`detail.actor.${h.kind === "edit" ? "merchant" : (h.actor as "customer" | "merchant" | "system")}`)}
                      </span>
                      {h.kind === "edit" && (
                        <ul className="flex flex-col text-sm">
                          {h.changes.map((change) => (
                            <li key={change.itemId}>
                              {change.variantTitle ? `${change.productName} (${change.variantTitle})` : change.productName}:{" "}
                              <span className="tabular-nums">{t("detail.editChange", { from: change.from, to: change.to })}</span>
                              {change.restocked > 0 && (
                                <span className="text-muted-foreground"> · {t("detail.editRestocked", { count: change.restocked })}</span>
                              )}
                            </li>
                          ))}
                          <li className="text-muted-foreground tabular-nums">
                            {t("detail.editSubtotal", { from: money(h.subtotalBeforeMinor), to: money(h.subtotalAfterMinor) })}
                          </li>
                        </ul>
                      )}
                      {h.note && <span className="text-sm whitespace-pre-line">{h.note}</span>}
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
