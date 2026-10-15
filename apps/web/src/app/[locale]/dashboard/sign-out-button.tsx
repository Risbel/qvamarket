"use client";

import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";

export function SignOutButton() {
  const t = useTranslations("Dashboard");
  const tPanel = useTranslations("Panel");
  const router = useRouter();

  async function signOut() {
    await authClient.signOut();
    toast.success(tPanel("toasts.signedOut"));
    router.push("/login");
    router.refresh();
  }

  return (
    <Button variant="outline" onClick={signOut}>
      {t("signOut")}
    </Button>
  );
}
