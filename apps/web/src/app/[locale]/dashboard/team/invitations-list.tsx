"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { cancelInvitationAction } from "@/server/invitation-actions";
import { useCan } from "@/components/permissions/permissions-provider";
import { LocalDateTime } from "@/components/local-date-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { invitationUrl } from "./invite-link-panel";

export type PendingInvitation = {
  id: string;
  email: string;
  roleName: string | null;
  inviterName: string;
  expiresAt: string;
};

/** Pending invitations of the company: copy the link again or cancel it (team:create). */
export function InvitationsList({ invitations }: { invitations: PendingInvitation[] }) {
  const t = useTranslations("Team");
  const locale = useLocale();
  const router = useRouter();
  const can = useCan();
  const [busy, setBusy] = useState<string | null>(null);
  const canManage = can({ team: ["create"] });

  async function copy(id: string) {
    await navigator.clipboard.writeText(invitationUrl(locale, id));
    toast.success(t("toasts.linkCopied"));
  }

  async function cancel(invitation: PendingInvitation) {
    setBusy(invitation.id);
    const result = await cancelInvitationAction(invitation.id).catch(() => null);
    setBusy(null);
    if (result?.ok) toast.success(t("toasts.invitationCanceled", { email: invitation.email }));
    else toast.error(t("errors.failed"));
    router.refresh();
  }

  if (invitations.length === 0) return null;

  return (
    <section className="flex flex-col gap-3" aria-labelledby="invitations-title">
      <h2 id="invitations-title" className="text-lg font-semibold">
        {t("pendingTitle")}
      </h2>
      <ul className="flex flex-col divide-y rounded-lg border">
        {invitations.map((invitation) => (
          <li key={invitation.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="truncate font-medium">{invitation.email}</span>
                {invitation.roleName && <Badge variant="outline">{invitation.roleName}</Badge>}
              </div>
              <span className="text-xs text-muted-foreground">
                {t("invitedBy", { name: invitation.inviterName })} · {t("expires")}{" "}
                <LocalDateTime iso={invitation.expiresAt} locale={locale} />
              </span>
            </div>
            {canManage && (
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => copy(invitation.id)}>
                  {t("copyLink")}
                </Button>
                <Button size="sm" variant="outline" disabled={busy === invitation.id} onClick={() => cancel(invitation)}>
                  {t("cancelInvitation")}
                </Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
