"use client";

import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useHydrated } from "@/lib/use-hydrated";

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
  const hydrated = useHydrated();

  return (
    <label className="flex items-center gap-1 text-sm">
      <span className="sr-only">{t("currency")}</span>
      <select
        value={current}
        disabled={!hydrated}
        onChange={(event) => {
          document.cookie = `${COOKIE}=${event.target.value}; path=/; max-age=31536000; samesite=lax`;
          router.refresh();
        }}
        className="rounded-md border border-current/30 bg-transparent px-1.5 py-1 text-sm"
        style={{ color: "inherit" }}
      >
        {codes.map((code) => (
          <option key={code} value={code} className="bg-popover text-popover-foreground">
            {code}
          </option>
        ))}
      </select>
    </label>
  );
}
