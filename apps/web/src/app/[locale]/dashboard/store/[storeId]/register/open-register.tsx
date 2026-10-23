"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowDownToLineIcon, ArrowUpFromLineIcon, LockIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useStoreId, useStorePath } from "@/components/panel-scope";
import { useCan } from "@/components/permissions/permissions-provider";
import { useRouter } from "@/i18n/navigation";
import { formatMoney, minorToInput, parsePriceToMinor } from "@/lib/money";
import type { DrawerCurrency, RegisterMovementKind } from "@/lib/register";
import { useHydrated } from "@/lib/use-hydrated";
import {
  createCloseRegisterSchema,
  createMovementSchema,
  type CloseRegisterValues,
  type MovementValues,
} from "@/lib/validation/register";
import { addRegisterMovementAction, closeRegisterAction, type RegisterActionResult } from "@/server/register-actions";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

type Currency = { code: string; digits: number };

export type OpenSessionView = {
  id: string;
  number: number;
  openedAt: string;
  /** the person responsible for the shift */
  cashier: string | null;
  /** the viewer's own shift */
  own: boolean;
  openingNote: string | null;
  drawers: DrawerCurrency[];
  movements: { id: string; kind: RegisterMovementKind; currency: string; amountMinor: number; note: string; createdAt: string; by: string | null }[];
};

const digitsOf = (currencies: Currency[], code: string) => currencies.find((c) => c.code === code)?.digits ?? 2;

/**
 * An open shift: the drawers, the cash in / out (own shift only) and the close (own shift, or
 * anyone's for a supervisor). Only a supervisor sees what each drawer should hold; a cashier
 * counts blind.
 */
export function OpenRegister({ session, currencies, supervise }: { session: OpenSessionView; currencies: Currency[]; supervise: boolean }) {
  const t = useTranslations("Register");
  const locale = useLocale();
  const hydrated = useHydrated();
  const can = useCan();
  const [dialog, setDialog] = useState<RegisterMovementKind | "close" | null>(null);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2 className="flex flex-wrap items-center gap-2">
            {session.own ? t("session.yours") : t("session.title", { number: session.number })}
            <Badge>{t("session.open")}</Badge>
          </h2>
        </CardTitle>
        <CardDescription>
          {session.own && `${t("session.title", { number: session.number })} · `}
          {t("session.openedAt")} <LocalDateTime iso={session.openedAt} locale={locale} />
          {session.cashier && <span className="block">{t("session.cashier", { name: session.cashier })}</span>}
          {session.openingNote && <span className="block whitespace-pre-line">{session.openingNote}</span>}
        </CardDescription>
        <CardAction className="flex flex-wrap gap-2">
          {session.own && can({ register: ["create"] }) && (
            <>
              <Button size="sm" variant="outline" disabled={!hydrated} onClick={() => setDialog("in")}>
                <ArrowDownToLineIcon />
                {t("actions.in")}
              </Button>
              <Button size="sm" variant="outline" disabled={!hydrated} onClick={() => setDialog("out")}>
                <ArrowUpFromLineIcon />
                {t("actions.out")}
              </Button>
            </>
          )}
          {(session.own || supervise) && can({ register: ["update"] }) && (
            <Button size="sm" disabled={!hydrated} onClick={() => setDialog("close")}>
              <LockIcon />
              {t("actions.close")}
            </Button>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <div className="grid gap-4 md:grid-cols-2">
          {session.drawers.map((drawer) => (
            <DrawerCard key={drawer.currency} drawer={drawer} blind={!supervise} />
          ))}
        </div>

        <section aria-labelledby="movements-title" className="flex flex-col gap-2">
          <h3 id="movements-title" className="font-medium">
            {t("movements.title")}
          </h3>
          {session.movements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("movements.empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border">
              {session.movements.map((m) => (
                <li key={m.id} className="flex flex-wrap items-start justify-between gap-2 p-3 text-sm">
                  <span className="flex flex-col gap-0.5">
                    <span className="font-medium">{m.note}</span>
                    <span className="text-xs text-muted-foreground">
                      <LocalDateTime iso={m.createdAt} locale={locale} />
                      {m.by && ` · ${m.by}`}
                    </span>
                  </span>
                  <span className={m.kind === "out" ? "font-medium text-destructive tabular-nums" : "font-medium tabular-nums"}>
                    {m.kind === "out" ? "−" : "+"}
                    {formatMoney(m.amountMinor, m.currency, locale)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </CardContent>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent>
          {(dialog === "in" || dialog === "out") && (
            <MovementForm
              kind={dialog}
              currencies={currencies}
              drawers={supervise ? session.drawers : null}
              onDone={() => setDialog(null)}
              onCancel={() => setDialog(null)}
            />
          )}
          {dialog === "close" && (
            <CloseForm session={session} blind={!supervise} currencies={currencies} onCancel={() => setDialog(null)} />
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}

/**
 * One currency's drawer: how the expected cash adds up, then what is listed but not counted.
 * `blind` (a cashier) shows only the float, the cash in / out and how many records there are.
 */
function DrawerCard({ drawer: d, blind }: { drawer: DrawerCurrency; blind: boolean }) {
  const t = useTranslations("Register.drawer");
  const locale = useLocale();
  const money = (minor: number) => formatMoney(minor, d.currency, locale);
  const line = (label: string, minor: number, sign: "+" | "−" | "") => (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">
        {sign && minor !== 0 ? `${sign} ` : ""}
        {money(minor)}
      </dd>
    </div>
  );
  if (blind) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border p-4">
        <span className="font-semibold">{d.currency}</span>
        <dl className="flex flex-col gap-1 text-sm">
          {line(t("opening"), d.openingMinor, "")}
          {line(t("cashIn"), d.cashInMinor, "+")}
          {line(t("cashOut"), d.cashOutMinor, "−")}
          <div className="flex justify-between gap-2">
            <dt className="text-muted-foreground">{t("records", { payments: d.payments, expenses: d.expenses })}</dt>
          </div>
        </dl>
        <p className="text-xs text-muted-foreground">{t("blind")}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold">{d.currency}</span>
        <span className="text-sm text-muted-foreground">{t("expectedLabel")}</span>
      </div>
      <p className="text-2xl font-semibold tabular-nums">{money(d.expectedMinor)}</p>
      <dl className="flex flex-col gap-1 text-sm">
        {line(t("opening"), d.openingMinor, "")}
        {line(t("cashPayments"), d.cashPaymentsMinor, "+")}
        {line(t("cashRefunds"), d.cashRefundsMinor, "−")}
        {line(t("cashIn"), d.cashInMinor, "+")}
        {line(t("cashOut"), d.cashOutMinor, "−")}
        {line(t("cashExpenses"), d.cashExpensesMinor, "−")}
      </dl>
      <Separator />
      <dl className="flex flex-col gap-1 text-sm">
        {line(t("transfers"), d.byMethod.transfer.paymentsMinor - d.byMethod.transfer.refundsMinor, "")}
        {line(t("other"), d.byMethod.other.paymentsMinor - d.byMethod.other.refundsMinor, "")}
        {d.otherExpensesMinor > 0 && line(t("otherExpenses"), d.otherExpensesMinor, "")}
        <div className="flex justify-between gap-2">
          <dt className="text-muted-foreground">{t("sales", { count: d.orders })}</dt>
          <dd className="tabular-nums">{money(d.salesMinor)}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">{t("notCounted")}</p>
    </div>
  );
}

function errorText(t: ReturnType<typeof useTranslations>, result: RegisterActionResult | null) {
  return t(`errors.${result && !result.ok ? result.error : "failed"}`);
}

function MovementForm({
  kind,
  currencies,
  drawers,
  onDone,
  onCancel,
}: {
  kind: RegisterMovementKind;
  currencies: Currency[];
  /** null = the person does not see what the drawer holds (a cashier) */
  drawers: DrawerCurrency[] | null;
  onDone: () => void;
  onCancel: () => void;
}) {
  const storeId = useStoreId();
  const t = useTranslations("Register.movement");
  const tr = useTranslations("Register");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [message, setMessage] = useState<string | null>(null);
  const form = useForm<MovementValues>({
    resolver: zodResolver(createMovementSchema(tv, currencies)),
    defaultValues: { kind, currencyCode: currencies[0]?.code ?? "", amount: "", note: "" },
  });
  const currencyCode = useWatch({ control: form.control, name: "currencyCode" });
  const inDrawer = drawers ? (drawers.find((d) => d.currency === currencyCode)?.expectedMinor ?? 0) : null;

  async function onSubmit(values: MovementValues) {
    setMessage(null);
    const result = await addRegisterMovementAction(storeId, values, locale).catch(() => null);
    if (result?.ok) {
      toast.success(t(kind === "in" ? "toastIn" : "toastOut"));
      router.refresh();
      return onDone();
    }
    if (result?.error === "invalid" && "fieldErrors" in result && result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) form.setError(field as keyof MovementValues, { message: messages[0] });
      return;
    }
    setMessage(errorText(tr, result));
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t(kind === "in" ? "titleIn" : "titleOut")}</DialogTitle>
        <DialogDescription>{t(kind === "in" ? "descriptionIn" : "descriptionOut")}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-[8rem_1fr]">
          <Controller
            name="currencyCode"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="movement-currency">{t("currency")}</FieldLabel>
                <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                  <SelectTrigger id="movement-currency" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {currencies.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
          <Controller
            name="amount"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="movement-amount">{t("amount")}</FieldLabel>
                <Input {...field} id="movement-amount" placeholder={minorToInput(digitsOf(currencies, currencyCode) === 0 ? 1000 : 2000, digitsOf(currencies, currencyCode))} invalid={fieldState.invalid} currency={currencyCode} />
                {kind === "out" && inDrawer !== null && <FieldDescription>{t("inDrawer", { amount: formatMoney(inDrawer, currencyCode, locale) })}</FieldDescription>}
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        </div>
        <Controller
          name="note"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="movement-note">{t("reason")}</FieldLabel>
              <Textarea {...field} id="movement-note" rows={2} placeholder={t(kind === "in" ? "reasonPlaceholderIn" : "reasonPlaceholderOut")} aria-invalid={fieldState.invalid} />
              <FieldDescription>{t("reasonHelp")}</FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={onCancel}>
          {tr("back")}
        </Button>
        <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
          {t(kind === "in" ? "submitIn" : "submitOut")}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** A money input with the currency code at its end. */
function Input({
  currency,
  invalid,
  ...props
}: React.ComponentProps<typeof InputGroupInput> & { currency: string; invalid: boolean }) {
  return (
    <InputGroup>
      <InputGroupInput {...props} inputMode="decimal" autoComplete="off" aria-invalid={invalid} />
      <InputGroupAddon align="inline-end">
        <InputGroupText>{currency}</InputGroupText>
      </InputGroupAddon>
    </InputGroup>
  );
}

/**
 * The close: the cash counted per currency, a note (required when a count does not match),
 * then the frozen report. A supervisor sees what is expected and the difference live; a
 * cashier counts blind: when the count does not match and there is no note, the server says
 * in which currencies (the attempt stays in the report) and they count again or explain it.
 */
function CloseForm({
  session,
  blind,
  currencies,
  onCancel,
}: {
  session: OpenSessionView;
  blind: boolean;
  currencies: Currency[];
  onCancel: () => void;
}) {
  const storeId = useStoreId();
  const storePathOf = useStorePath();
  const t = useTranslations("Register.close");
  const tr = useTranslations("Register");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [message, setMessage] = useState<string | null>(null);
  const drawers = session.drawers;
  const drawerCurrencies = drawers.map((d) => ({ code: d.currency, digits: digitsOf(currencies, d.currency) }));
  const expected = blind ? undefined : Object.fromEntries(drawers.map((d) => [d.currency, d.expectedMinor]));
  const form = useForm<CloseRegisterValues>({
    resolver: zodResolver(createCloseRegisterSchema(tv, drawerCurrencies, expected)),
    defaultValues: { counted: Object.fromEntries(drawers.map((d) => [d.currency, ""])), shown: expected, note: "" },
  });
  const counted = useWatch({ control: form.control, name: "counted" });

  async function onSubmit(values: CloseRegisterValues) {
    setMessage(null);
    const result = await closeRegisterAction(storeId, session.id, values, locale).catch(() => null);
    if (result?.ok) {
      toast.success(t("toast"));
      router.push(storePathOf(result.id ? `/register/${result.id}` : "/register"));
      return;
    }
    if (result?.error === "invalid" && "fieldErrors" in result && result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) form.setError(field as `counted.${string}`, { message: messages[0] });
      return;
    }
    if (result?.error === "noteRequired" && "currencies" in result) {
      for (const code of result.currencies) form.setError(`counted.${code}`, { message: t("mismatchField") });
      setMessage(t("mismatch", { currencies: result.currencies.join(", ") }));
      form.setFocus("note");
      return;
    }
    if (result?.error === "stale") {
      // Something was paid meanwhile: show the new expected amounts and count again
      router.refresh();
      onCancel();
      toast.error(t("stale"));
      return;
    }
    setMessage(errorText(tr, result));
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription>
          {!session.own && session.cashier
            ? t("descriptionOther", { name: session.cashier })
            : t(blind ? "descriptionBlind" : "description")}
        </DialogDescription>
      </DialogHeader>
      <FieldGroup>
        {drawers.map((d) => {
          const digits = digitsOf(currencies, d.currency);
          const typed = counted?.[d.currency] ?? "";
          const minor = typed.trim() === "" ? null : parsePriceToMinor(typed, digits, Number.MAX_SAFE_INTEGER);
          const difference = minor === null ? null : minor - d.expectedMinor;
          return (
            <Controller
              key={d.currency}
              name={`counted.${d.currency}`}
              control={form.control}
              render={({ field, fieldState }) => (
                <Field data-invalid={fieldState.invalid}>
                  <FieldLabel htmlFor={`counted-${d.currency}`}>{t("counted", { currency: d.currency })}</FieldLabel>
                  <Input
                    {...field}
                    id={`counted-${d.currency}`}
                    placeholder={minorToInput(blind ? (digits === 0 ? 5000 : 50000) : d.expectedMinor, digits)}
                    invalid={fieldState.invalid}
                    currency={d.currency}
                  />
                  {!blind && (
                    <FieldDescription>
                      {t("expected", { amount: formatMoney(d.expectedMinor, d.currency, locale) })}
                      {difference !== null && (
                        <span className={difference === 0 ? "ml-2 font-medium" : "ml-2 font-medium text-destructive"}>
                          {difference === 0
                            ? t("even")
                            : t(difference > 0 ? "over" : "short", { amount: formatMoney(Math.abs(difference), d.currency, locale) })}
                        </span>
                      )}
                    </FieldDescription>
                  )}
                  <FieldError errors={[fieldState.error]} />
                </Field>
              )}
            />
          );
        })}
        <Controller
          name="note"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="close-note">{tr("note")}</FieldLabel>
              <Textarea {...field} id="close-note" rows={2} placeholder={t("notePlaceholder")} aria-invalid={fieldState.invalid} />
              <FieldDescription>{t("noteHelp")}</FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>
      <p className="text-sm text-muted-foreground">{t("frozen")}</p>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={onCancel}>
          {tr("back")}
        </Button>
        <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
          {t("submit")}
        </Button>
      </DialogFooter>
    </form>
  );
}
