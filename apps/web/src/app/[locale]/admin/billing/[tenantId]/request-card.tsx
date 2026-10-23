"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import type { BillingCycle, BillingRequestKind } from "@/lib/billing";
import type { PlanKey } from "@/lib/plans";
import { useHydrated } from "@/lib/use-hydrated";
import { closeBillingRequestAction } from "@/server/billing-actions";
import { LocalDateTime } from "@/components/local-date-time";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export type RequestView = {
  kind: BillingRequestKind;
  planKey: PlanKey | null;
  cycle: BillingCycle | null;
  message: string | null;
  createdAt: string;
  createdBy: string | null;
};

/** The owner's open request: what they asked, and "Done" / "Dismiss" once it is handled. */
export function RequestCard({ tenantId, request }: { tenantId: string; request: RequestView }) {
  const t = useTranslations("Billing.request");
  const tp = useTranslations("Plans.plans");
  const tc = useTranslations("Billing.cycles");
  const locale = useLocale();
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);

  async function close(status: "done" | "dismissed") {
    setBusy(true);
    const result = await closeBillingRequestAction(tenantId, status).catch(() => null);
    setBusy(false);
    if (result?.ok) {
      toast.success(t(status === "done" ? "toasts.done" : "toasts.dismissed"));
      router.refresh();
    } else {
      toast.error(t("failed"));
    }
  }

  return (
    <Card className="border-primary">
      <CardHeader>
        <CardTitle>
          <h2>{t("title")}</h2>
        </CardTitle>
        <CardDescription>
          <LocalDateTime iso={request.createdAt} locale={locale} />
          {request.createdBy && ` · ${request.createdBy}`}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p className="font-medium">
          {request.kind === "plan" && request.planKey
            ? t("plan", { plan: tp(`${request.planKey}.name`), cycle: request.cycle ? tc(request.cycle) : "" })
            : t(`kind.${request.kind}`)}
        </p>
        {request.message && <p className="whitespace-pre-line">{request.message}</p>}
        <p className="text-sm text-muted-foreground">{t("help")}</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!hydrated || busy} onClick={() => close("done")}>
            {t("done")}
          </Button>
          <Button size="sm" variant="outline" disabled={!hydrated || busy} onClick={() => close("dismissed")}>
            {t("dismiss")}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
