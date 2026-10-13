"use client";

import { Coins, GalleryHorizontal, MapPin, Palette, Store, Truck } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

/** Settings sections: a new one = an entry here + `Settings.nav.<key>` messages + its page. */
const SECTIONS = [
  { key: "general", href: "/dashboard/settings/general", icon: Store },
  { key: "branding", href: "/dashboard/settings/branding", icon: Palette },
  { key: "banner", href: "/dashboard/settings/banner", icon: GalleryHorizontal },
  { key: "currencies", href: "/dashboard/settings/currencies", icon: Coins },
  { key: "pickup", href: "/dashboard/settings/pickup", icon: Truck },
  { key: "delivery", href: "/dashboard/settings/delivery", icon: MapPin },
] as const;

/** Section menu: a horizontal scrolling row on phones, a vertical list from `md` up. */
export function SettingsNav() {
  const t = useTranslations("Settings.nav");
  const pathname = usePathname();

  return (
    <nav
      aria-label={t("label")}
      className="-mx-4 flex gap-1 overflow-x-auto border-b px-4 pb-2 md:mx-0 md:flex-col md:overflow-visible md:border-b-0 md:px-0 md:pb-0"
    >
      {SECTIONS.map(({ key, href, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={key}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm whitespace-nowrap text-muted-foreground transition-colors",
              "hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              active && "bg-muted font-medium text-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
            {t(key)}
          </Link>
        );
      })}
    </nav>
  );
}
