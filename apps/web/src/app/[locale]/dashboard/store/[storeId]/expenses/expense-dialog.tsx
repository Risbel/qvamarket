"use client";

import { useStoreId } from "@/components/panel-scope";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { PlusIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { EXPENSE_CATEGORIES, type ExpenseCategory } from "@/lib/expenses";
import { minorToInput } from "@/lib/money";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/orders";
import { useHydrated } from "@/lib/use-hydrated";
import { createExpenseSchema, type ExpenseFormValues } from "@/lib/validation/expense";
import { createExpenseAction, updateExpenseAction, type ExpenseActionResult } from "@/server/expense-actions";
import { DateTimePicker } from "@/components/date-time-picker";
import { isoToLocalInput, localInputToIso } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type ExpenseCurrency = { code: string; digits: number };
export type ExpenseMember = { userId: string; name: string };
/** An expense being edited (what the form starts from). */
export type EditableExpense = {
  id: string;
  category: ExpenseCategory;
  amountMinor: number;
  currencyCode: string;
  method: PaymentMethod;
  /** ISO instant */
  paidAt: string;
  payee: string | null;
  memberUserId: string | null;
  note: string | null;
};

type ErrorKey = "forbidden" | "notFound" | "memberNotFound" | "failed";
/** "No team member" in the member select (a Select value cannot be "") */
const NO_MEMBER = "none";
const pad = (n: number) => String(n).padStart(2, "0");

/** The page header's "New expense" button and its dialog. */
export function NewExpenseButton(props: { currencies: ExpenseCurrency[]; defaultCurrency: string; members: ExpenseMember[] }) {
  const t = useTranslations("Expenses");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <PlusIcon data-icon="inline-start" />
        {t("new")}
      </Button>
      <ExpenseDialog {...props} open={open} expense={null} onOpenChange={setOpen} />
    </>
  );
}

/** Records a new expense (`expense` = null) or edits one. */
export function ExpenseDialog({
  open,
  expense,
  onOpenChange,
  ...props
}: {
  open: boolean;
  expense: EditableExpense | null;
  onOpenChange: (open: boolean) => void;
  currencies: ExpenseCurrency[];
  defaultCurrency: string;
  members: ExpenseMember[];
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        {/* Mounted while open only: each opening starts from the expense (or empty) */}
        {open && <ExpenseForm {...props} expense={expense} onDone={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}

function ExpenseForm({
  expense,
  currencies,
  defaultCurrency,
  members,
  onDone,
}: {
  expense: EditableExpense | null;
  currencies: ExpenseCurrency[];
  defaultCurrency: string;
  members: ExpenseMember[];
  onDone: () => void;
}) {
  const storeId = useStoreId();
  const t = useTranslations("Expenses.form");
  const tc = useTranslations("Expenses.categories");
  const tm = useTranslations("Expenses.methods");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [message, setMessage] = useState<ErrorKey | null>(null);
  // The dialog only opens after a click, so this runs in the browser (its clock and timezone)
  const [now] = useState(() => new Date());
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const digitsOf = (code: string) => currencies.find((c) => c.code === code)?.digits ?? 2;

  // A member who left the company still shows on the salaries they were paid
  const memberOptions =
    expense?.memberUserId && !members.some((m) => m.userId === expense.memberUserId)
      ? [...members, { userId: expense.memberUserId, name: expense.payee ?? "—" }]
      : members;

  const form = useForm<ExpenseFormValues>({
    resolver: zodResolver(createExpenseSchema(tv, currencies)),
    defaultValues: expense
      ? {
          category: expense.category,
          amount: minorToInput(expense.amountMinor, digitsOf(expense.currencyCode)),
          // An expense in a currency the store no longer sells is re-saved in the default one
          currency: currencies.some((c) => c.code === expense.currencyCode) ? expense.currencyCode : defaultCurrency,
          method: expense.method,
          paidAt: isoToLocalInput(expense.paidAt),
          payee: expense.payee ?? "",
          memberUserId: expense.memberUserId ?? "",
          note: expense.note ?? "",
        }
      : { category: "salaries", amount: "", currency: defaultCurrency, method: "cash", paidAt: "", payee: "", memberUserId: "", note: "" },
  });
  const [category, currency] = useWatch({ control: form.control, name: ["category", "currency"] });

  async function onSubmit(values: ExpenseFormValues) {
    setMessage(null);
    const payload = { ...values, paidAt: localInputToIso(values.paidAt) };
    const result: ExpenseActionResult | null = await (expense
      ? updateExpenseAction(storeId, expense.id, payload, locale)
      : createExpenseAction(storeId, payload, locale)
    ).catch(() => null);
    if (result?.ok) {
      toast.success(t(expense ? "toasts.updated" : "toasts.created"));
      onDone();
      router.refresh();
      return;
    }
    if (result?.error === "invalid" && result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        form.setError(field as keyof ExpenseFormValues, { message: messages[0] });
      }
      return;
    }
    if (result?.error === "memberNotFound") {
      form.setError("memberUserId", { message: t("errors.memberNotFound") });
      return;
    }
    setMessage(result?.error === "forbidden" || result?.error === "notFound" ? result.error : "failed");
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t(expense ? "editTitle" : "newTitle")}</DialogTitle>
        <DialogDescription>{t("help")}</DialogDescription>
      </DialogHeader>
      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="category"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="expense-category">{t("category")}</FieldLabel>
                <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                  <SelectTrigger id="expense-category" className="w-full">
                    <SelectValue>{(value: ExpenseCategory) => tc(value)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((option) => (
                      <SelectItem key={option} value={option}>
                        {tc(option)}
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
                <FieldLabel htmlFor="expense-amount">{t("amount")}</FieldLabel>
                <InputGroup>
                  <InputGroupInput
                    {...field}
                    id="expense-amount"
                    inputMode="decimal"
                    autoComplete="off"
                    placeholder={t("amountPlaceholder", { example: minorToInput(5000 * 10 ** digitsOf(currency), digitsOf(currency)) })}
                    aria-invalid={fieldState.invalid}
                  />
                  {currencies.length > 1 ? (
                    <Controller
                      name="currency"
                      control={form.control}
                      render={({ field: currencyField }) => (
                        <InputGroupAddon align="inline-end">
                          <Select value={currencyField.value} onValueChange={(value) => value && currencyField.onChange(value)}>
                            <SelectTrigger size="sm" aria-label={t("currency")} className="border-0 shadow-none">
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
                        </InputGroupAddon>
                      )}
                    />
                  ) : (
                    <InputGroupAddon align="inline-end">
                      <InputGroupText>{currency}</InputGroupText>
                    </InputGroupAddon>
                  )}
                </InputGroup>
                <FieldError errors={[fieldState.error, form.formState.errors.currency]} />
              </Field>
            )}
          />
        </div>

        {category === "salaries" && (
          <Controller
            name="memberUserId"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="expense-member">{t("member")}</FieldLabel>
                <Select
                  value={field.value || NO_MEMBER}
                  onValueChange={(value) => field.onChange(!value || value === NO_MEMBER ? "" : value)}
                >
                  <SelectTrigger id="expense-member" className="w-full">
                    <SelectValue>
                      {(value: string) => memberOptions.find((m) => m.userId === value)?.name ?? t("noMember")}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_MEMBER}>{t("noMember")}</SelectItem>
                    {memberOptions.map((m) => (
                      <SelectItem key={m.userId} value={m.userId}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>{t("memberHelp")}</FieldDescription>
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Controller
            name="payee"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor="expense-payee">{t("payee")}</FieldLabel>
                <Input
                  {...field}
                  id="expense-payee"
                  autoComplete="off"
                  placeholder={t(category === "salaries" ? "payeeSalaryPlaceholder" : "payeePlaceholder")}
                  aria-invalid={fieldState.invalid}
                />
                <FieldError errors={[fieldState.error]} />
              </Field>
            )}
          />
          <Controller
            name="method"
            control={form.control}
            render={({ field }) => (
              <Field>
                <FieldLabel htmlFor="expense-method">{t("method")}</FieldLabel>
                <Select value={field.value} onValueChange={(value) => value && field.onChange(value)}>
                  <SelectTrigger id="expense-method" className="w-full">
                    <SelectValue>{(value: PaymentMethod) => tm(value)}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHODS.map((option) => (
                      <SelectItem key={option} value={option}>
                        {tm(option)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          />
        </div>

        <Controller
          name="paidAt"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="expense-date">{t("paidAt")}</FieldLabel>
              <DateTimePicker
                id="expense-date"
                value={field.value}
                onChange={field.onChange}
                defaultTime={`${pad(now.getHours())}:${pad(now.getMinutes())}`}
                maxDate={now}
                locale={locale}
                invalid={fieldState.invalid}
                labels={{ placeholder: t("datePlaceholder"), time: t("time"), clear: t("dateClear") }}
              />
              <FieldDescription>
                {t("paidAtHelp")} {t("timeZone", { zone: timeZone })}
              </FieldDescription>
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />

        <Controller
          name="note"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="expense-note">{t("note")}</FieldLabel>
              <Textarea {...field} id="expense-note" rows={2} placeholder={t("notePlaceholder")} aria-invalid={fieldState.invalid} />
              <FieldError errors={[fieldState.error]} />
            </Field>
          )}
        />
      </FieldGroup>
      {message && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${message}`)}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={onDone}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
          {form.formState.isSubmitting ? t("saving") : t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
