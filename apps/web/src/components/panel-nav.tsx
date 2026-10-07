"use client";

import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const ITEMS = [
  { href: "/dashboard", key: "home", exact: true },
  { href: "/dashboard/products", key: "products", exact: false },
] as const;

export type PanelNavKey = (typeof ITEMS)[number]["key"];

/** `visible`: the items the member is allowed to use (computed on the server from permissions). */
export function PanelNav({ visible }: { visible: readonly PanelNavKey[] }) {
  const t = useTranslations("Panel.nav");
  const pathname = usePathname();

  return (
    <nav className="flex gap-1" aria-label={t("label")}>
      {ITEMS.filter((item) => visible.includes(item.key)).map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-muted",
              active ? "bg-muted font-medium" : "text-muted-foreground",
            )}
          >
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}
