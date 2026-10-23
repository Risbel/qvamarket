"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { useHydrated } from "@/lib/use-hydrated";
import { respondToInvitationAction } from "@/server/invitation-actions";
import { Button } from "@/components/ui/button";

/** Accept / decline buttons of an invitation. */
export function InviteResponse({ id, companyName }: { id: string; companyName: string }) {
  const t = useTranslations("Invite");
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function respond(accept: boolean) {
    setBusy(true);
    setError(null);
    const result = await respondToInvitationAction(id, accept).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      const error = result?.error;
      setError(
        t(
          error === "closed" || error === "notFound"
            ? "closed"
            : error === "alreadyMember"
              ? "alreadyMemberShort"
              : error === "teamFull"
                ? "teamFull"
                : "failed",
        ),
      );
      router.refresh();
      return;
    }
    if (accept) {
      toast.success(t("toasts.accepted", { company: companyName }));
      router.push("/dashboard");
    } else {
      toast.success(t("toasts.declined"));
    }
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <Button disabled={!hydrated || busy} onClick={() => respond(true)}>
          {t("accept")}
        </Button>
        <Button variant="outline" disabled={!hydrated || busy} onClick={() => respond(false)}>
          {t("decline")}
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

/** Signs out and goes to the login page, coming back to this invitation afterwards. */
export function SwitchAccountButton({ next }: { next: string }) {
  const t = useTranslations("Invite");
  const router = useRouter();
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);

  async function switchAccount() {
    setBusy(true);
    await authClient.signOut();
    router.push(`/login?next=${encodeURIComponent(next)}`);
    router.refresh();
  }

  return (
    <Button disabled={!hydrated || busy} onClick={switchAccount}>
      {t("switchAccount")}
    </Button>
  );
}
