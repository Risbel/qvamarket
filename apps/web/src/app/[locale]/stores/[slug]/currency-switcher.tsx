"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/** Must match CURRENCY_COOKIE in src/server/storefront-currency.ts */
const COOKIE = "qvashop_currency";

/**
 * Lets the shopper pick one of the store's currencies. The choice is a host-only cookie (each
 * store subdomain keeps its own) read by the server, so prices are always rendered and
 * charged by the server in that currency.
 */
export function CurrencySwitcher({ codes, current }: { codes: string[]; current: string }) {
  const t = useTranslations("Store");
  const router = useRouter();

  return (
    <Select
      value={current}
      onValueChange={(code) => {
        if (typeof code !== "string" || code === current) return;
        document.cookie = `${COOKIE}=${code}; path=/; max-age=31536000; samesite=lax`;
        router.refresh();
      }}
    >
      {/* Same look as the other header buttons: no border, round brand-tinted background on
          hover / while open, and the brand's readable foreground (the chevron too) */}
      <SelectTrigger
        aria-label={t("currency")}
        className="gap-1 rounded-full border-0 bg-transparent pr-2 pl-3 font-medium text-inherit hover:bg-current/15 focus-visible:ring-2 focus-visible:ring-current data-popup-open:bg-current/15 data-[size=default]:h-9 dark:bg-transparent dark:hover:bg-current/15 [&_svg]:text-current"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent alignItemWithTrigger={false} align="end" className="w-auto min-w-24">
        {codes.map((code) => (
          <SelectItem key={code} value={code}>
            {code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
