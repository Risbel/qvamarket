"use client";

import { useEffect, useState } from "react";
import { Building2, Check, ChevronsUpDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { useRouter } from "@/i18n/navigation";
import { setActiveCompanyAction } from "@/server/company-actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

export type PanelCompany = { id: string; name: string };

/** Tabs of the same browser share the session, so a switch in one tab concerns all of them. */
const CHANNEL = "qvashop:active-company";

function announce(company: PanelCompany) {
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage(company);
  channel.close();
}

/**
 * Sidebar item to pick the company the panel works on (only rendered with 2+ companies).
 * The choice is saved on the session; the other open tabs are told (see CompanySwitchGuard).
 */
export function CompanySwitcher({ companies, activeId }: { companies: PanelCompany[]; activeId: string }) {
  const t = useTranslations("Panel.company");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const active = companies.find((c) => c.id === activeId);

  async function choose(company: PanelCompany) {
    if (company.id === activeId || busy) return;
    setBusy(true);
    const result = await setActiveCompanyAction(company.id).catch(() => null);
    setBusy(false);
    if (!result?.ok) {
      toast.error(t("error"));
      router.refresh();
      return;
    }
    announce(company);
    toast.success(t("switched", { name: company.name }));
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<SidebarMenuButton tooltip={t("switch")} disabled={busy} className="text-sm" />}
        >
          <Building2 className="size-4" />
          <span className="grid flex-1 text-left leading-tight">
            <span className="truncate text-xs text-muted-foreground">{t("label")}</span>
            <span className="truncate">{active?.name}</span>
          </span>
          <ChevronsUpDown className="ml-auto size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-56">
          <DropdownMenuLabel>{t("switch")}</DropdownMenuLabel>
          {companies.map((company) => (
            <DropdownMenuItem key={company.id} onClick={() => choose(company)}>
              <Building2 />
              <span className="flex-1 truncate">{company.name}</span>
              {company.id === activeId && <Check aria-label={t("current")} />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}

/**
 * Blocks a tab that still shows another company after the user switched in a different tab,
 * so nothing is saved into the wrong company by accident (the server still checks the
 * permissions in whichever company is active). Rendered once in the merchant panel layout.
 */
export function CompanySwitchGuard({ activeId }: { activeId: string }) {
  const t = useTranslations("Panel.company");
  const [switchedTo, setSwitchedTo] = useState<PanelCompany | null>(null);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = (event: MessageEvent<PanelCompany>) => {
      setSwitchedTo(event.data?.id && event.data.id !== activeId ? event.data : null);
    };
    return () => channel.close();
  }, [activeId]);

  return (
    <Dialog open={switchedTo !== null} disablePointerDismissal>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{t("staleTitle")}</DialogTitle>
          <DialogDescription>{t("staleDescription", { name: switchedTo?.name ?? "" })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => window.location.reload()}>{t("reload")}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
