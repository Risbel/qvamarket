"use client";

import { useTranslations } from "next-intl";
import { useActiveNavKey, type PanelNavGroup } from "@/components/panel-sidebar";

/** Name of the section the current page belongs to, next to the sidebar toggle. */
export function PanelPageTitle({ basePath, groups }: { basePath: string; groups: PanelNavGroup[] }) {
  const t = useTranslations("Panel.nav");
  const key = useActiveNavKey(basePath, groups);
  return <span className="truncate text-sm font-medium">{key ? t(key) : null}</span>;
}
