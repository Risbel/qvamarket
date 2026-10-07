"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  resetMerchantPasswordAction,
  type ResetPasswordActionResult,
} from "@/server/merchant-actions";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export function ResetPasswordDialog({
  userId,
  email,
}: {
  userId: string;
  email: string;
}) {
  const t = useTranslations("Admin.reset");
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ResetPasswordActionResult | null>(null);
  const [copied, setCopied] = useState(false);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Forget the credentials as soon as the dialog closes
      setResult(null);
      setCopied(false);
    }
  }

  async function confirm() {
    setPending(true);
    setResult(await resetMerchantPasswordAction(userId));
    setPending(false);
  }

  async function copy(text: string) {
    await navigator.clipboard.writeText(text);
    setCopied(true);
  }

  const credentials =
    result?.ok === true
      ? `${t("email")}: ${result.email}\n${t("password")}: ${result.temporaryPassword}`
      : "";

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        disabled={!hydrated}
        onClick={() => setOpen(true)}
      >
        {t("button")}
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          {result?.ok ? (
            <>
              <DialogHeader>
                <DialogTitle>{t("doneTitle")}</DialogTitle>
                <DialogDescription>{t("warning")}</DialogDescription>
              </DialogHeader>
              <pre className="rounded-md bg-muted p-3 font-mono text-sm whitespace-pre-wrap break-all">
                {credentials}
              </pre>
              <DialogFooter>
                <Button onClick={() => copy(credentials)}>
                  {copied ? t("copied") : t("copy")}
                </Button>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {t("close")}
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>{t("title")}</DialogTitle>
                <DialogDescription>{t("confirm", { email })}</DialogDescription>
              </DialogHeader>
              {result && !result.ok && (
                <p role="alert" className="text-sm text-destructive">
                  {t(`errors.${result.error}`)}
                </p>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  {t("cancel")}
                </Button>
                <Button onClick={confirm} disabled={pending}>
                  {pending ? t("resetting") : t("confirmButton")}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
