"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";

/**
 * Sign-in details shown once (new member or password reset): no email provider, so the
 * owner hands them over. The caller forgets them when its dialog closes.
 */
export function CredentialsPanel({ email, temporaryPassword }: { email: string; temporaryPassword: string }) {
  const t = useTranslations("Team.credentials");
  const [copied, setCopied] = useState(false);
  const text = `${t("email")}: ${email}\n${t("password")}: ${temporaryPassword}`;

  async function copy() {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">{t("warning")}</p>
      <pre className="rounded-md bg-muted p-3 font-mono text-sm break-all whitespace-pre-wrap">{text}</pre>
      <Button variant="outline" onClick={copy} className="self-start">
        {copied ? t("copied") : t("copy")}
      </Button>
    </div>
  );
}
