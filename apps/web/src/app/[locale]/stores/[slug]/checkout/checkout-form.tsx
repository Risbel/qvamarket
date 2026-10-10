"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm, type Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useLocale, useTranslations } from "next-intl";
import { Link, useRouter } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { useHydrated } from "@/lib/use-hydrated";
import { createCheckoutSchema, type CheckoutValues } from "@/lib/validation/checkout";
import { priceCartAction, type PriceCartActionResult } from "@/server/cart-actions";
import { placeOrderAction } from "@/server/checkout-actions";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useCart } from "../cart-provider";

type Priced = Extract<PriceCartActionResult, { ok: true }>;
type Message = "cartChanged" | "tooManyRequests" | "failed" | "notFound" | "priceFailed";

/**
 * Pickup checkout. The summary is priced by the server (as in the cart); only the lines that
 * can be bought are ordered, and the subtotal shown is sent along so the server can refuse
 * the order if anything changed in the meantime (the customer then sees the new summary).
 */
export function CheckoutForm({ pickup }: { pickup: { address: string | null; instructions: string | null } }) {
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
    defaultValues: { name: "", phone: "", email: "", note: "" },
  });

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

  async function onSubmit(values: CheckoutValues) {
    if (!priced) return;
    setMessage(null);
    const result = await placeOrderAction(
      { slug: storeSlug, currency: priced.currency, expectedSubtotalMinor: subtotalMinor, idempotencyKey },
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
          <FieldGroup>
            <Text control={form.control} name="name" label={t("contact.name")} autoComplete="name" />
            <Text
              control={form.control}
              name="phone"
              label={t("contact.phone")}
              help={t("contact.phoneHelp")}
              type="tel"
              autoComplete="tel"
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

        <section className="flex flex-col gap-2 rounded-lg border p-4" aria-labelledby="pickup-title">
          <h2 id="pickup-title" className="font-semibold">
            {t("pickup.title")}
          </h2>
          {pickup.address && <p className="text-sm whitespace-pre-line">{pickup.address}</p>}
          {pickup.instructions && (
            <p className="text-sm whitespace-pre-line text-muted-foreground">{pickup.instructions}</p>
          )}
          <p className="text-sm text-muted-foreground">{t("pickup.payment")}</p>
        </section>

        {message && (
          <p role="alert" className="text-sm text-destructive">
            {t(`errors.${message}`)}
          </p>
        )}

        <button
          type="submit"
          disabled={!hydrated || buyable.length === 0 || form.formState.isSubmitting}
          className="rounded-md px-6 py-3 font-semibold disabled:opacity-50"
          style={{ backgroundColor: "var(--brand)", color: "var(--brand-foreground)" }}
        >
          {form.formState.isSubmitting ? t("placing") : t("place", { total: money(subtotalMinor) })}
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
        <div className="flex justify-between border-t pt-3 font-semibold">
          <span>{t("total")}</span>
          <span className="tabular-nums" data-testid="total">
            {money(subtotalMinor)}
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
