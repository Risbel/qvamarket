"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";
import { setSecondaryBannerVisibleAction } from "@/server/secondary-banner-actions";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Switch } from "@/components/ui/switch";

/** Shows or hides the secondary banner on the storefront; its images are kept either way. */
export function SecondaryBannerSwitch({ visible }: { visible: boolean }) {
  const t = useTranslations("Banner.secondary");
  const router = useRouter();
  const hydrated = useHydrated();
  const [checked, setChecked] = useState(visible);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onChange(next: boolean) {
    setChecked(next);
    setBusy(true);
    setFailed(false);
    try {
      const result = await setSecondaryBannerVisibleAction(next);
      if (!result.ok) throw new Error(result.error);
      toast.success(t(next ? "toasts.shown" : "toasts.hidden"));
    } catch {
      setChecked(!next);
      setFailed(true);
    }
    setBusy(false);
    router.refresh();
  }

  return (
    <Field orientation="horizontal">
      <Switch
        id="secondary-banner-visible"
        checked={checked}
        onCheckedChange={onChange}
        disabled={!hydrated || busy}
      />
      <div className="flex flex-col gap-1">
        <FieldLabel htmlFor="secondary-banner-visible">{t("visible")}</FieldLabel>
        <FieldDescription>{t("visibleHelp")}</FieldDescription>
        {failed && (
          <p role="alert" className="text-sm text-destructive">
            {t("errors.failed")}
          </p>
        )}
      </div>
    </Field>
  );
}
