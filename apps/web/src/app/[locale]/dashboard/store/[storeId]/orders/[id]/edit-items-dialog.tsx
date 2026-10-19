"use client";

import { useStoreId } from "@/components/panel-scope";
import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { MinusIcon, PencilIcon, PlusIcon, Trash2Icon, Undo2Icon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { editedSubtotal } from "@/lib/orders";
import { useHydrated } from "@/lib/use-hydrated";
import { createOrderEditSchema, type OrderEditValues } from "@/lib/validation/order-edit";
import { editOrderItemsAction } from "@/server/order-actions";
import { Button } from "@/components/ui/button";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";

export type EditableItem = {
  id: string;
  productName: string;
  variantTitle: string | null;
  quantity: number;
  unitPriceMinor: number;
  /** checkout took its units from the stock, so they can go back */
  stockDeducted: boolean;
};

type ErrorKey = "forbidden" | "notFound" | "stale" | "notAllowed" | "empty" | "failed";

/**
 * "Edit items" button + dialog (needs `order:edit`): lower or remove lines before the order
 * is handed over, choosing per line whether the units go back to the stock (on by default:
 * the customer changed their mind; off when the product was not really there). The delivery
 * fee stays as charged; if more was collected than the new total, the merchant records the
 * refund in Payments.
 */
export function EditItemsDialog(props: {
  orderId: string;
  reference: string;
  currency: string;
  deliveryFeeMinor: number;
  /** what was collected (net), or null when the viewer cannot see payments */
  collectedMinor: number | null;
  items: EditableItem[];
}) {
  const t = useTranslations("Orders.edit");
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button size="sm" variant="outline" disabled={!hydrated} onClick={() => setOpen(true)}>
        <PencilIcon />
        {t("open")}
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && setOpen(false)}>
        <DialogContent className="sm:max-w-xl">
          {open && <EditItemsForm {...props} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function EditItemsForm({
  orderId,
  reference,
  currency,
  deliveryFeeMinor,
  collectedMinor,
  items,
  onDone,
}: {
  orderId: string;
  reference: string;
  currency: string;
  deliveryFeeMinor: number;
  collectedMinor: number | null;
  items: EditableItem[];
  onDone: () => void;
}) {
  const storeId = useStoreId();
  const t = useTranslations("Orders.edit");
  const tv = useTranslations("Validation");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [message, setMessage] = useState<ErrorKey | null>(null);
  const money = (minor: number) => formatMoney(minor, currency, locale);

  const form = useForm<OrderEditValues>({
    resolver: zodResolver(createOrderEditSchema(tv)),
    defaultValues: {
      lines: items.map((item) => ({ itemId: item.id, from: item.quantity, to: item.quantity, restock: true })),
      note: "",
    },
  });
  const lines = useWatch({ control: form.control, name: "lines" });
  const changed = lines.some((line) => line.to < line.from);
  const subtotal = editedSubtotal(items, new Map(lines.map((line) => [line.itemId, line.to])));
  const total = subtotal + deliveryFeeMinor;
  const overpaid = collectedMinor !== null ? Math.max(collectedMinor - total, 0) : 0;
  const linesError = form.formState.errors.lines?.message ?? form.formState.errors.lines?.root?.message;

  async function onSubmit(values: OrderEditValues) {
    setMessage(null);
    const result = await editOrderItemsAction(storeId, orderId, values, locale).catch(() => null);
    if (result?.ok) {
      const details = [
        result.restockedUnits > 0 ? t("toasts.restocked", { count: result.restockedUnits }) : null,
        result.overpaidMinor > 0 ? t("toasts.refundDue", { amount: money(result.overpaidMinor) }) : null,
      ].filter(Boolean);
      toast.success(t("toasts.saved", { reference }), details.length ? { description: details.join(" ") } : undefined);
      onDone();
      return router.refresh();
    }
    if (result?.error === "invalid" && result.fieldErrors) {
      for (const [field, messages] of Object.entries(result.fieldErrors)) {
        form.setError(field as keyof OrderEditValues, { message: messages[0] });
      }
      return;
    }
    setMessage(result && result.error !== "invalid" ? result.error : "failed");
    // Someone else changed the order: show its current state behind the dialog
    if (result?.error === "stale" || result?.error === "notAllowed") router.refresh();
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex min-w-0 flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t("title", { reference })}</DialogTitle>
        <DialogDescription>{t("description")}</DialogDescription>
      </DialogHeader>

      <ul className="flex flex-col divide-y rounded-lg border">
        {items.map((item, index) => {
          const line = lines[index];
          const removed = line.to === 0;
          const lowered = line.to < line.from;
          return (
            <li key={item.id} className="flex flex-col gap-3 p-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className={removed ? "font-medium text-muted-foreground line-through" : "font-medium"}>
                    {item.productName}
                  </span>
                  {item.variantTitle && <span className="text-sm text-muted-foreground">{item.variantTitle}</span>}
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {t("unitPrice", { price: money(item.unitPriceMinor) })}
                  </span>
                </div>
                <Controller
                  name={`lines.${index}.to`}
                  control={form.control}
                  render={({ field }) => (
                    <div className="flex items-center gap-1">
                      <ButtonGroup aria-label={t("quantity", { product: item.productName })}>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label={t("decrease")}
                          disabled={field.value <= 0}
                          onClick={() => field.onChange(field.value - 1)}
                        >
                          <MinusIcon aria-hidden />
                        </Button>
                        <ButtonGroupText className="min-w-9 justify-center bg-background tabular-nums dark:bg-input/30">
                          {field.value}
                        </ButtonGroupText>
                        <Button
                          type="button"
                          variant="outline"
                          size="icon-sm"
                          aria-label={t("increase")}
                          disabled={field.value >= line.from}
                          onClick={() => field.onChange(field.value + 1)}
                        >
                          <PlusIcon aria-hidden />
                        </Button>
                      </ButtonGroup>
                      {removed ? (
                        <Button type="button" variant="ghost" size="icon-sm" title={t("undo")} aria-label={t("undo")} onClick={() => field.onChange(line.from)}>
                          <Undo2Icon aria-hidden />
                        </Button>
                      ) : (
                        <Button type="button" variant="ghost" size="icon-sm" title={t("remove")} aria-label={t("remove")} onClick={() => field.onChange(0)}>
                          <Trash2Icon aria-hidden />
                        </Button>
                      )}
                    </div>
                  )}
                />
              </div>
              {lowered && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-muted-foreground tabular-nums">
                    {removed ? t("removed", { count: line.from }) : t("lowered", { from: line.from, to: line.to })}
                  </span>
                  {item.stockDeducted && (
                    <Controller
                      name={`lines.${index}.restock`}
                      control={form.control}
                      render={({ field }) => (
                        <label htmlFor={`restock-${item.id}`} className="flex items-center gap-2">
                          <Checkbox id={`restock-${item.id}`} checked={field.value} onCheckedChange={field.onChange} />
                          {t("restock", { count: line.from - line.to })}
                        </label>
                      )}
                    />
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {linesError && (
        <p role="alert" className="text-sm text-destructive">
          {linesError}
        </p>
      )}

      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
        <dt className="text-muted-foreground">{t("newSubtotal")}</dt>
        <dd className="text-right tabular-nums">{money(subtotal)}</dd>
        {deliveryFeeMinor > 0 && (
          <>
            <dt className="text-muted-foreground">{t("deliveryFee")}</dt>
            <dd className="text-right tabular-nums">{money(deliveryFeeMinor)}</dd>
          </>
        )}
        <dt className="font-medium">{t("newTotal")}</dt>
        <dd className="text-right font-medium tabular-nums">{money(total)}</dd>
      </dl>
      {overpaid > 0 && <p className="text-sm text-muted-foreground">{t("refundHint", { amount: money(overpaid) })}</p>}

      <Separator />

      <FieldGroup>
        <Controller
          name="note"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor="edit-note">{t("note")}</FieldLabel>
              <Textarea {...field} id="edit-note" rows={2} placeholder={t("notePlaceholder")} aria-invalid={fieldState.invalid} />
              <FieldDescription>{t("noteHelp")}</FieldDescription>
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
          {t("back")}
        </Button>
        <Button type="submit" disabled={!hydrated || !changed || form.formState.isSubmitting}>
          {t("save")}
        </Button>
      </DialogFooter>
    </form>
  );
}
