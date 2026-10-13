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
      {/* On the brand color: keep its readable foreground (the chevron too) */}
      <SelectTrigger
        size="sm"
        aria-label={t("currency")}
        className="border-current/30 bg-transparent text-inherit hover:bg-current/15 dark:bg-transparent dark:hover:bg-current/15 [&_svg]:text-current"
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
