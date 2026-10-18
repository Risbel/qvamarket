"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { invitationPath } from "@/lib/invitations";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";

/** The full invitation URL on this host (the panel's), with the page's locale. */
export function invitationUrl(locale: string, id: string) {
  return `${window.location.origin}/${locale}${invitationPath(id)}`;
}

/** Shows an invitation link to send to the person, with a copy button. */
export function InviteLinkPanel({ id, email }: { id: string; email: string }) {
  const t = useTranslations("Team.inviteLink");
  const locale = useLocale();
  const hydrated = useHydrated();
  const url = hydrated ? invitationUrl(locale, id) : "";
  const [copied, setCopied] = useState(false);

  async function copy() {
    await navigator.clipboard.writeText(url);
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t("help", { email })}</p>
      <pre className="rounded-md bg-muted p-3 font-mono text-sm break-all whitespace-pre-wrap">{url}</pre>
      <Button variant="outline" onClick={copy} disabled={!url} className="self-start">
        {copied ? t("copied") : t("copy")}
      </Button>
    </div>
  );
}
