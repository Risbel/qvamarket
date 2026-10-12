"use client";

import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ChevronDownIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { isFinalStatus, nextStatuses, type OrderStatus } from "@/lib/orders";
import { useHydrated } from "@/lib/use-hydrated";
import { createOrderStatusSchema, type OrderStatusValues } from "@/lib/validation/order-status";
import { changeOrderStatusAction, type OrderStatusActionResult } from "@/server/order-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";

type Message = { kind: "error" | "notice"; text: string };

/**
 * Status buttons of an order: the next step in one click, later steps (skipping) in a menu,
 * and cancel. Completing and cancelling are final, so they ask for confirmation and take an
 * optional note for the history.
 */
export function StatusActions({
  orderId,
  reference,
  status,
  fulfillmentType,
}: {
  orderId: string;
  /** "#12" */
  reference: string;
  status: OrderStatus;
  fulfillmentType: string;
}) {
  const t = useTranslations("Orders.actions");
  const tStatus = useTranslations("Orders.status");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<OrderStatus | null>(null);
  const [message, setMessage] = useState<Message | null>(null);

  const options = nextStatuses(status, fulfillmentType);
  const [next] = options;
  const skips = options.slice(1).filter((to) => to !== "cancelled");

  async function change(values: OrderStatusValues): Promise<OrderStatusActionResult | null> {
    setBusy(true);
    setMessage(null);
    const result = await changeOrderStatusAction(orderId, values, locale).catch(() => null);
    setBusy(false);
    if (result?.ok) {
      setConfirming(null);
      if (result.restockedUnits > 0) setMessage({ kind: "notice", text: t("restocked", { count: result.restockedUnits }) });
    } else if (result?.error === "invalid" && result.fieldErrors) {
      return result; // shown on the dialog's fields
    } else {
      const error = result?.error === "stale" || result?.error === "notAllowed" ? "stale" : result?.error === "forbidden" ? "forbidden" : "failed";
      setConfirming(null);
      setMessage({ kind: "error", text: t(`errors.${error}`) });
    }
    router.refresh();
    return result;
  }

  function choose(to: OrderStatus) {
    if (isFinalStatus(to)) setConfirming(to);
    else void change({ from: status, to, note: "" });
  }

  if (!next) {
    return <p className="text-sm text-muted-foreground">{t("final")}</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {next !== "cancelled" && (
          <Button disabled={!hydrated || busy} onClick={() => choose(next)}>
            {t(`to.${next}`)}
          </Button>
        )}
        {skips.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" disabled={!hydrated || busy} />}>
              {t("other")}
              <ChevronDownIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {skips.map((to) => (
                <DropdownMenuItem key={to} onClick={() => choose(to)}>
                  {t(`to.${to}`)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button variant="destructive" disabled={!hydrated || busy} onClick={() => choose("cancelled")}>
          {t("to.cancelled")}
        </Button>
      </div>
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
          {message.text}
        </p>
      )}

      <Dialog open={confirming !== null} onOpenChange={(open) => !open && !busy && setConfirming(null)}>
        <DialogContent>
          {confirming && (
            <ConfirmForm
              key={confirming}
              from={status}
              to={confirming}
              reference={reference}
              busy={busy}
              label={t(`to.${confirming}`)}
              statusName={tStatus(confirming)}
              onCancel={() => setConfirming(null)}
              onConfirm={change}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ConfirmForm({
  from,
  to,
  reference,
  busy,
  label,
  statusName,
  onCancel,
  onConfirm,
}: {
  from: OrderStatus;
  to: OrderStatus;
  reference: string;
  busy: boolean;
  label: string;
  statusName: string;
  onCancel: () => void;
  onConfirm: (values: OrderStatusValues) => Promise<OrderStatusActionResult | null>;
}) {
  const t = useTranslations("Orders.actions");
  const tv = useTranslations("Validation");
  const hydrated = useHydrated();
  const schema = useMemo(() => createOrderStatusSchema(tv), [tv]);
  const form = useForm<OrderStatusValues>({ resolver: zodResolver(schema), defaultValues: { from, to, note: "" } });
  const cancelling = to === "cancelled";

  async function onSubmit(values: OrderStatusValues) {
    const result = await onConfirm(values);
    if (result && !result.ok && result.fieldErrors?.note) form.setError("note", { message: result.fieldErrors.note[0] });
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
      <DialogHeader>
        <DialogTitle>{t(cancelling ? "confirmCancelTitle" : "confirmTitle", { reference, status: statusName })}</DialogTitle>
        <DialogDescription>{t(cancelling ? "confirmCancel" : "confirmFinal")}</DialogDescription>
      </DialogHeader>
      <Controller
        name="note"
        control={form.control}
        render={({ field, fieldState }) => (
          <Field data-invalid={fieldState.invalid}>
            <FieldLabel htmlFor="status-note">{t(cancelling ? "reason" : "note")}</FieldLabel>
            <Textarea {...field} id="status-note" rows={3} aria-invalid={fieldState.invalid} />
            <FieldDescription>{t("noteHelp")}</FieldDescription>
            <FieldError errors={[fieldState.error]} />
          </Field>
        )}
      />
      <DialogFooter>
        <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
          {t("back")}
        </Button>
        <Button type="submit" variant={cancelling ? "destructive" : "default"} disabled={!hydrated || busy}>
          {label}
        </Button>
      </DialogFooter>
    </form>
  );
}
