"use client";

import { useState } from "react";
import { CheckIcon, LinkIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useHydrated } from "@/lib/use-hydrated";
import { Button } from "@/components/ui/button";
import { SocialIcon } from "@/components/social-icon";

/**
 * Copy the product link / share it on WhatsApp. The link is read when clicked, so it keeps
 * the `?variant=` the picker wrote into the URL (the shared link opens the same variant).
 */
export function ShareButtons({ productName }: { productName: string }) {
  const t = useTranslations("Store.product.share");
  const hydrated = useHydrated();
  const [copied, setCopied] = useState(false);

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      toast.success(t("copied"));
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t("copyFailed"));
    }
  }

  function shareOnWhatsApp() {
    const text = t("whatsappText", { name: productName, url: window.location.href });
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" variant="outline" onClick={copyLink} disabled={!hydrated}>
        {copied ? <CheckIcon aria-hidden /> : <LinkIcon aria-hidden />}
        {t(copied ? "copiedShort" : "copy")}
      </Button>
      <Button
        type="button"
        onClick={shareOnWhatsApp}
        disabled={!hydrated}
        aria-label={t("whatsappLabel")}
      >
        <SocialIcon network="whatsapp" className="size-4" />
        {t("whatsapp")}
      </Button>
    </div>
  );
}
