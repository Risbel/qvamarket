"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FOOTER_TABS, type FooterTab } from "./tabs";

/**
 * Tabs of the footer settings (shadcn Tabs): about (short text under the logo + name) | links |
 * social media. Social media is not built yet, so its tab is shown disabled; when it is, give
 * it a panel, add it to FOOTER_TABS and enable the trigger. The open tab is kept in the URL
 * (`?tab=links`) with replaceState, like the banner tabs; the first tab has no parameter.
 */
export function FooterTabs({ defaultTab, about, links }: { defaultTab: FooterTab; about: ReactNode; links: ReactNode }) {
  const t = useTranslations("Settings.footer.tabs");
  const [tab, setTab] = useState<FooterTab>(defaultTab);

  function onValueChange(next: unknown) {
    const chosen = FOOTER_TABS.find((value) => value === next) ?? "about";
    setTab(chosen);
    const url = new URL(window.location.href);
    if (chosen === "about") url.searchParams.delete("tab");
    else url.searchParams.set("tab", chosen);
    window.history.replaceState(null, "", url);
  }

  return (
    <Tabs value={tab} onValueChange={onValueChange} className="gap-6">
      <div className="border-b">
        <TabsList variant="line" aria-label={t("label")} className="justify-start">
          <TabsTrigger value="about" className="flex-none px-3">
            {t("about")}
          </TabsTrigger>
          <TabsTrigger value="links" className="flex-none px-3">
            {t("links")}
          </TabsTrigger>
          <TabsTrigger value="social" disabled className="flex-none px-3">
            {t("social")}
            <span className="rounded-full bg-muted px-1.5 text-[0.65rem] font-normal text-muted-foreground">
              {t("soon")}
            </span>
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="about">{about}</TabsContent>
      <TabsContent value="links">{links}</TabsContent>
    </Tabs>
  );
}
