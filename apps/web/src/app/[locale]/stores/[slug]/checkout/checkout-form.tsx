"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, useWatch, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { deliveryFee, distanceMeters, insideArea } from "@/lib/delivery";
import { formatMoney } from "@/lib/money";
import { useHydrated } from "@/lib/use-hydrated";
import { createCheckoutSchema, type CheckoutValues } from "@/lib/validation/checkout";
import { priceCartAction, type PriceCartActionResult } from "@/server/cart-actions";
import { placeOrderAction } from "@/server/checkout-actions";
import type { PublicDelivery } from "@/server/public-delivery";
import { Button } from "@/components/ui/button";
import type { CountryOption } from "@/components/country-select";
import { PhoneInput } from "@/components/phone-input";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCart } from "../cart-provider";
import { DeliveryPinMap } from "./delivery-pin-map";

type Priced = Extract<PriceCartActionResult, { ok: true }>;
type Message =
  | "cartChanged"
  | "tooManyRequests"
  | "failed"
  | "notFound"
  | "priceFailed"
  | "pickupUnavailable"
  | "deliveryUnavailable"
  | "outsideArea"
  | "belowMinimum"
  | "deliveryChanged";

/** What the delivery choice costs right now (computed here for display; the server recomputes it). */
type Quote =
  | { kind: "noPin" }
  | { kind: "outside" }
  | { kind: "noRate" }
  | { kind: "belowMinimum"; minOrderMinor: number }
  | { kind: "ok"; feeMinor: number; freeAbove: boolean; distanceM: number };

/**
 * Checkout: contact details, then pickup or home delivery (a pin on the map inside the
 * store's area plus the typed address). The summary is priced by the server (as in the cart);
 * only the lines that can be bought are ordered. The subtotal and the delivery fee shown are
 * sent along so the server can refuse the order if anything changed in the meantime (the
 * customer then sees the new amounts).
 */
export function CheckoutForm({
  pickup,
  options,
  countries,
  defaultCountry,
  account,
}: {
  pickup: { address: string | null; instructions: string | null };
  /** pickup on/off and the home delivery settings (public view) */
  options: PublicDelivery;
  countries: CountryOption[];
  /** the store's country for phone numbers ("" = none) */
  defaultCountry: string;
  /** the signed-in customer (prefills the contact form), or null for a guest */
  account: { name: string; email: string; phone: string } | null;
}) {
  const t = useTranslations("Store.checkout");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const { storeSlug, currency, items, clear } = useCart();
  const [priced, setPriced] = useState<Priced | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [placed, setPlaced] = useState(false);
  const [refresh, setRefresh] = useState(0);
  // One key per checkout attempt: a retried submit (double click, lost response) cannot
  // create a second order
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const latest = useRef(0);

  const schema = useMemo(() => createCheckoutSchema(tv), [tv]);
  const form = useForm<CheckoutValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: account?.name ?? "",
      phoneCountry: defaultCountry,
      phone: account?.phone ?? "",
      email: account?.email ?? "",
      note: "",
      fulfillment: options.pickupEnabled ? "pickup" : "delivery",
      address: "",
      location: null,
    },
  });
  const phoneCountry = useWatch({ control: form.control, name: "phoneCountry" });
  const fulfillment = useWatch({ control: form.control, name: "fulfillment" });
  const location = useWatch({ control: form.control, name: "location" });
  const [locating, setLocating] = useState<"idle" | "busy" | "failed">("idle");

  const signature = JSON.stringify(items);
  useEffect(() => {
    if (items.length === 0) return;
    const request = ++latest.current;
    priceCartAction(storeSlug, currency, items)
      .catch(() => null)
      .then((result) => {
        if (request !== latest.current) return;
        if (!result || !result.ok) {
          setMessage(result && result.error === "tooManyRequests" ? "tooManyRequests" : "priceFailed");
          return;
        }
        setPriced(result);
      });
    // `signature` stands for `items`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, storeSlug, currency, refresh]);

  if (placed) {
    return (
      <p role="status" className="text-muted-foreground">
        {t("redirecting")}
      </p>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-start gap-3">
        <p className="text-muted-foreground">{t("empty")}</p>
        <Link href="/" className="text-sm font-medium underline underline-offset-4">
          {t("continueShopping")}
        </Link>
      </div>
    );
  }

  if (!priced) {
    return (
      <p role="status" className="text-muted-foreground">
        {message ? t(`errors.${message}`) : t("loading")}
      </p>
    );
  }

  const money = (minor: number) => formatMoney(minor, priced.currency, locale);
  const buyable = priced.lines.filter((line) => line.status === "ok" || line.status === "reduced");
  const left = priced.lines.length - buyable.length;
  const subtotalMinor = buyable.reduce((sum, line) => sum + line.lineTotalMinor, 0);

  // Delivery in this currency needs amounts, except in free mode
  const delivery = options.delivery;
  const deliveryRate = delivery?.rates[priced.currency] ?? null;
  const deliveryOffered = !!delivery && (delivery.mode === "free" || !!deliveryRate);
  const quote: Quote | null = (() => {
    if (fulfillment !== "delivery" || !delivery) return null;
    if (!location) return { kind: "noPin" };
    if (!insideArea(location, delivery.area)) return { kind: "outside" };
    const distanceM = Math.round(distanceMeters(delivery.location, location));
    const result = deliveryFee(delivery, deliveryRate, distanceM, subtotalMinor);
    if (result.ok) return { kind: "ok", feeMinor: result.feeMinor, freeAbove: result.freeAbove, distanceM };
    return result.reason === "noRate" ? { kind: "noRate" } : { kind: "belowMinimum", minOrderMinor: result.minOrderMinor };
  })();
  const feeMinor = quote?.kind === "ok" ? quote.feeMinor : 0;
  const totalMinor = subtotalMinor + feeMinor;
  const canPlace = fulfillment === "pickup" ? options.pickupEnabled : deliveryOffered && quote?.kind === "ok";

  function locateMe() {
    if (!navigator.geolocation) return setLocating("failed");
    setLocating("busy");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating("idle");
        form.setValue(
          "location",
          { lat: position.coords.latitude, lng: position.coords.longitude },
          { shouldValidate: form.formState.isSubmitted },
        );
      },
      () => setLocating("failed"),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  }

  async function onSubmit(values: CheckoutValues) {
    if (!priced) return;
    setMessage(null);
    const result = await placeOrderAction(
      {
        slug: storeSlug,
        currency: priced.currency,
        expectedSubtotalMinor: subtotalMinor,
        ...(values.fulfillment === "delivery" ? { expectedDeliveryFeeMinor: feeMinor } : {}),
        idempotencyKey,
      },
      buyable.map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
      values,
      locale,
    ).catch(() => null);

    if (!result) {
      setMessage("failed");
    } else if (result.ok) {
      setPlaced(true);
      clear();
      router.replace(`/orders/${result.orderId}`);
    } else if (result.error === "invalid" && result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        form.setError(field as keyof CheckoutValues, { message: messages[0] });
      }
    } else if (result.error === "cartChanged" || result.error === "empty") {
      setMessage("cartChanged");
      setRefresh((n) => n + 1);
    } else if (result.error === "deliveryChanged" || result.error === "deliveryUnavailable" || result.error === "pickupUnavailable") {
      // The store changed its delivery settings: reload them (server props) and re-price
      setMessage(result.error);
      router.refresh();
      setRefresh((n) => n + 1);
    } else {
      setMessage(result.error === "invalid" ? "failed" : result.error);
    }
  }

  return (
    <div className="grid gap-8 md:grid-cols-[minmax(0,1fr)_20rem] md:items-start">
      <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-6">
        <section className="flex flex-col gap-3" aria-labelledby="contact-title">
          <h2 id="contact-title" className="text-lg font-semibold">
            {t("contact.title")}
          </h2>
          {account ? (
            <p className="text-sm text-muted-foreground">
              {t("account.signedIn", { name: account.name })}{" "}
              <Link href="/account" className="underline underline-offset-4">
                {t("account.myAccount")}
              </Link>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("account.guest")}{" "}
              <Link href={{ pathname: "/login", query: { next: "/checkout" } }} className="underline underline-offset-4">
                {t("account.signIn")}
              </Link>
            </p>
          )}
          <FieldGroup>
            <Text control={form.control} name="name" label={t("contact.name")} autoComplete="name" />
            <Controller
              name="phone"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="phone">{t("contact.phone")}</FieldLabel>
                  <PhoneInput
                    {...field}
                    id="phone"
                    autoComplete="tel"
                    invalid={fieldState.invalid}
                    country={phoneCountry}
                    onCountryChange={(code) => form.setValue("phoneCountry", code, { shouldValidate: form.formState.isSubmitted })}
                    options={countries}
                    countryLabel={t("contact.country")}
                    countryPlaceholder={t("contact.countryNone")}
                  />
                  <FieldDescription>{t("contact.phoneHelp")}</FieldDescription>
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
            <Text
              control={form.control}
              name="email"
              label={t("contact.email")}
              type="email"
              autoComplete="email"
            />
            <Controller
              name="note"
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor="note">{t("contact.note")}</FieldLabel>
                  <Textarea {...field} id="note" rows={3} aria-invalid={fieldState.invalid} />
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          </FieldGroup>
        </section>

        <section className="flex flex-col gap-3" aria-labelledby="fulfillment-title">
          <h2 id="fulfillment-title" className="text-lg font-semibold">
            {t("fulfillment.title")}
          </h2>
          {options.pickupEnabled && delivery && (
            <div role="radiogroup" aria-label={t("fulfillment.title")} className="grid gap-2 sm:grid-cols-2">
              {(["pickup", "delivery"] as const).map((option) => {
                const disabled = option === "delivery" && !deliveryOffered;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={fulfillment === option}
                    disabled={disabled}
                    onClick={() => form.setValue("fulfillment", option, { shouldValidate: form.formState.isSubmitted })}
                    className="flex flex-col items-start gap-0.5 rounded-lg border p-3 text-left text-sm disabled:opacity-50 aria-checked:border-[var(--brand)] aria-checked:ring-2 aria-checked:ring-[var(--brand)]"
                  >
                    <span className="font-medium">{t(`fulfillment.${option}`)}</span>
                    <span className="text-muted-foreground">
                      {disabled ? t("fulfillment.notInCurrency", { currency: priced.currency }) : t(`fulfillment.${option}Help`)}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {fulfillment === "pickup" && options.pickupEnabled && (
            <div className="flex flex-col gap-2 rounded-lg border p-4">
              <h3 className="font-semibold">{t("pickup.title")}</h3>
              {pickup.address && <p className="text-sm whitespace-pre-line">{pickup.address}</p>}
              {pickup.instructions && <p className="text-sm whitespace-pre-line text-muted-foreground">{pickup.instructions}</p>}
            </div>
          )}

          {fulfillment === "delivery" && delivery && deliveryOffered && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-foreground">{t("delivery.pinHelp")}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" disabled={locating === "busy"} onClick={locateMe}>
                  {locating === "busy" ? t("delivery.locating") : t("delivery.useMyLocation")}
                </Button>
                {locating === "failed" && <span className="text-sm text-muted-foreground">{t("delivery.locationFailed")}</span>}
              </div>
              <DeliveryPinMap
                area={delivery.area}
                storeLocation={delivery.location}
                value={location}
                onChange={(point) => form.setValue("location", point, { shouldValidate: form.formState.isSubmitted })}
                locale={locale}
                labels={{ map: t("delivery.mapLabel"), error: t("delivery.mapError"), unavailable: t("delivery.tilesUnavailable") }}
              />
              <FieldError errors={[form.formState.errors.location]} />
              {quote && quote.kind !== "noPin" && (
                <p role="status" className={quote.kind === "ok" ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
                  {quote.kind === "outside"
                    ? t("delivery.outside")
                    : quote.kind === "noRate"
                      ? t("fulfillment.notInCurrency", { currency: priced.currency })
                      : quote.kind === "belowMinimum"
                        ? t("delivery.belowMinimum", { amount: money(quote.minOrderMinor) })
                        : quote.feeMinor === 0
                          ? t(quote.freeAbove ? "delivery.freeAbove" : "delivery.free", { km: (quote.distanceM / 1000).toFixed(1) })
                          : t("delivery.fee", { fee: money(quote.feeMinor), km: (quote.distanceM / 1000).toFixed(1) })}
                </p>
              )}
              <Controller
                name="address"
                control={form.control}
                render={({ field, fieldState }) => (
                  <Field data-invalid={fieldState.invalid}>
                    <FieldLabel htmlFor="address">{t("delivery.address")}</FieldLabel>
                    <Textarea {...field} id="address" rows={3} autoComplete="street-address" aria-invalid={fieldState.invalid} />
                    <FieldDescription>{t("delivery.addressHelp")}</FieldDescription>
                    <FieldError errors={[fieldState.error]} />
                  </Field>
                )}
              />
            </div>
          )}

          {!options.pickupEnabled && !deliveryOffered && <p className="text-sm text-destructive">{t("fulfillment.none")}</p>}
          <p className="text-sm text-muted-foreground">{t("pickup.payment")}</p>
        </section>

        {message && (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${message}`)}
          </p>
        )}

        <button
          type="submit"
          disabled={!hydrated || buyable.length === 0 || !canPlace || form.formState.isSubmitting}
          className="rounded-md px-6 py-3 font-semibold disabled:opacity-50"
          style={{ backgroundColor: "var(--brand)", color: "var(--brand-foreground)" }}
        >
          {form.formState.isSubmitting ? t("placing") : t("place", { total: money(totalMinor) })}
        </button>
      </form>

      <aside className="flex flex-col gap-4 rounded-lg border p-4" aria-labelledby="summary-title">
        <h2 id="summary-title" className="font-semibold">
          {t("summary")}
        </h2>
        <ul className="flex flex-col gap-3">
          {buyable.map((line) => (
            <li key={line.variantId} className="flex justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">{line.name}</span>
                {line.variantTitle && <span className="block text-muted-foreground">{line.variantTitle}</span>}
                <span className="block text-muted-foreground">
                  {line.quantity} × {money(line.unitPriceMinor)}
                </span>
              </span>
              <span className="shrink-0 tabular-nums">{money(line.lineTotalMinor)}</span>
            </li>
          ))}
        </ul>
        {left > 0 && (
          <p className="text-sm text-muted-foreground">
            {t("leftOut", { count: left })}{" "}
            <Link href="/cart" className="underline underline-offset-4">
              {t("reviewCart")}
            </Link>
          </p>
        )}
        {fulfillment === "delivery" && (
          <div className="flex flex-col gap-1 border-t pt-3 text-sm">
            <div className="flex justify-between">
              <span>{t("subtotal")}</span>
              <span className="tabular-nums">{money(subtotalMinor)}</span>
            </div>
            <div className="flex justify-between">
              <span>{t("delivery.summaryLabel")}</span>
              <span className="tabular-nums" data-testid="delivery-fee">
                {quote?.kind === "ok" ? (quote.feeMinor === 0 ? t("delivery.summaryFree") : money(quote.feeMinor)) : "—"}
              </span>
            </div>
          </div>
        )}
        <div className="flex justify-between border-t pt-3 font-semibold">
          <span>{t("total")}</span>
          <span className="tabular-nums" data-testid="total">
            {money(totalMinor)}
          </span>
        </div>
      </aside>
    </div>
  );
}

type FieldProps = {
  control: Control<CheckoutValues>;
  name: "name" | "phone" | "email";
  label: string;
  help?: string;
};

function Text({ control, name, label, help, ...inputProps }: FieldProps & Omit<React.ComponentProps<typeof Input>, "name">) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => (
        <Field data-invalid={fieldState.invalid}>
          <FieldLabel htmlFor={name}>{label}</FieldLabel>
          <Input {...inputProps} {...field} id={name} aria-invalid={fieldState.invalid} />
          {help && <FieldDescription>{help}</FieldDescription>}
          <FieldError errors={[fieldState.error]} />
        </Field>
      )}
    />
  );
}
