"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { FALLBACK_PLAN, PLAN_FEATURES, type PlanFeature, type PlanKey } from "@/lib/plans";
import { useHydrated } from "@/lib/use-hydrated";
import { createPlanSettingSchema, type PlanSettingValues } from "@/lib/validation/billing";
import { setPlanSettingAction } from "@/server/billing-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

type Setting = { planKey: PlanKey; features: readonly PlanFeature[]; offered: boolean };

/** Edits what a plan includes and whether merchants can choose it (any plan, Gratis included). */
export function PlanDialog({ setting }: { setting: Setting }) {
  const t = useTranslations("Billing.plansSection");
  const tp = useTranslations("Plans.plans");
  const tf = useTranslations("CompanyBilling.features");
  const ta = useTranslations("Billing.actions");
  const router = useRouter();
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const defaults: PlanSettingValues = { planKey: setting.planKey, features: [...setting.features], offered: setting.offered };
  const form = useForm<PlanSettingValues>({ resolver: zodResolver(createPlanSettingSchema()), defaultValues: defaults });
  const name = tp(`${setting.planKey}.name`);

  function onOpenChange(next: boolean) {
    if (form.formState.isSubmitting) return;
    setOpen(next);
    if (!next) {
      form.reset(defaults);
      setMessage(null);
    }
  }

  async function onSubmit(values: PlanSettingValues) {
    setMessage(null);
    const result = await setPlanSettingAction(values).catch(() => null);
    if (result?.ok) {
      toast.success(t("toasts.saved", { plan: name }));
      setOpen(false);
      router.refresh();
      return;
    }
    setMessage(ta(`errors.${result && !result.ok ? result.error : "failed"}`, { amount: "" }));
  }

  return (
    <>
      <Button size="sm" variant="outline" disabled={!hydrated} onClick={() => setOpen(true)}>
        {t("edit")}
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <form onSubmit={form.handleSubmit(onSubmit)} method="post" noValidate className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>{t("editTitle", { plan: name })}</DialogTitle>
              <DialogDescription>{t("dialogDescription")}</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <Controller
                name="offered"
                control={form.control}
                render={({ field }) => (
                  <Field orientation="horizontal">
                    <Switch id="plan-offered" checked={field.value} onCheckedChange={field.onChange} />
                    <FieldContent>
                      <FieldLabel htmlFor="plan-offered">{t("offeredLabel")}</FieldLabel>
                      <FieldDescription>{t(setting.planKey === FALLBACK_PLAN ? "offeredHelpFallback" : "offeredHelp")}</FieldDescription>
                    </FieldContent>
                  </Field>
                )}
              />
              <Controller
                name="features"
                control={form.control}
                render={({ field }) => (
                  <FieldSet>
                    <FieldLegend variant="label">{t("features")}</FieldLegend>
                    <FieldDescription>{t("featuresHelp")}</FieldDescription>
                    <ul className="grid gap-2 rounded-md border p-3 sm:grid-cols-2">
                      {PLAN_FEATURES.map((feature) => {
                        const id = `plan-feature-${feature}`;
                        return (
                          <li key={feature}>
                            <label htmlFor={id} className="flex items-center gap-2 text-sm">
                              <Checkbox
                                id={id}
                                checked={field.value.includes(feature)}
                                onCheckedChange={(checked) =>
                                  field.onChange(checked === true ? [...field.value, feature] : field.value.filter((f) => f !== feature))
                                }
                              />
                              {tf(feature)}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </FieldSet>
                )}
              />
            </FieldGroup>
            {message && (
              <p role="alert" className="text-sm text-destructive">
                {message}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={form.formState.isSubmitting} onClick={() => onOpenChange(false)}>
                {ta("back")}
              </Button>
              <Button type="submit" disabled={!hydrated || form.formState.isSubmitting}>
                {t("save")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
