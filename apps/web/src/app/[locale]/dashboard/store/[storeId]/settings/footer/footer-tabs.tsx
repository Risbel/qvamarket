"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FOOTER_TABS, type FooterTab } from "./tabs";

/**
 * Tabs of the footer settings (shadcn Tabs): about (short text under the logo + name) | links |
 * social media. The open tab is kept in the URL (`?tab=links`) with replaceState, like the
 * banner tabs; the first tab has no parameter.
 */
export function FooterTabs({
  defaultTab,
  about,
  links,
  social,
}: {
  defaultTab: FooterTab;
  about: ReactNode;
  links: ReactNode;
  social: ReactNode;
}) {
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
          {FOOTER_TABS.map((value) => (
            <TabsTrigger key={value} value={value} className="flex-none px-3">
              {t(value)}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      <TabsContent value="about">{about}</TabsContent>
      <TabsContent value="links">{links}</TabsContent>
      <TabsContent value="social">{social}</TabsContent>
    </Tabs>
  );
}
