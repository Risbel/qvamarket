"use client";

import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { orgPath } from "@/lib/panel-paths";
import { setActiveCompanyAction } from "@/server/company-actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

export type PanelCompany = { id: string; name: string };

/**
 * Sidebar item to open another company (only rendered with 2+ companies). The company is in
 * the URL, so this is plain navigation (each tab can show its own company); the choice is
 * also saved on the session so /dashboard opens it next time.
 */
export function CompanySwitcher({ companies, activeId }: { companies: PanelCompany[]; activeId: string }) {
  const t = useTranslations("Panel.company");
  const active = companies.find((c) => c.id === activeId);

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger render={<SidebarMenuButton tooltip={t("switch")} className="text-sm" />}>
          <Building2 className="size-4" />
          <span className="grid flex-1 text-left leading-tight">
            <span className="truncate text-xs text-muted-foreground">{t("label")}</span>
            <span className="truncate">{active?.name}</span>
          </span>
          <ChevronsUpDown className="ml-auto size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          {/* Base UI: a menu label must live inside a group */}
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t("switch")}</DropdownMenuLabel>
            {companies.map((company) => (
              <DropdownMenuItem
                key={company.id}
                render={
                  <Link
                    href={orgPath(company.id)}
                    // Remembered for /dashboard; navigation does not wait for it
                    onClick={() => void setActiveCompanyAction(company.id).catch(() => {})}
                  />
                }
              >
                <Building2 />
                <span className="flex-1 truncate">{company.name}</span>
                {company.id === activeId && <Check aria-label={t("current")} />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
