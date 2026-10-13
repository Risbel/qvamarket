"use client";

import { useState, type ReactNode } from "react";
import { LockIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type BannerTab = "main" | "secondary";

/**
 * Tabs of the banner settings (shadcn Tabs): main banner | secondary banner. The secondary
 * banner sits under the main one, so its tab is disabled until the main banner has images.
 * The open tab is kept in the URL (`?tab=secondary`) with replaceState, so a reload or a
 * shared link opens the same tab without a server round trip on every switch.
 *
 * Controlled on purpose: after each change the page is refreshed (router.refresh()), and the
 * server then reads the updated URL and sends a different `defaultTab`. Only the first one
 * counts; afterwards the open tab lives here.
 */
export function BannerTabs({
  defaultTab,
  secondaryLocked,
  main,
  secondary,
}: {
  defaultTab: BannerTab;
  secondaryLocked: boolean;
  main: ReactNode;
  secondary: ReactNode;
}) {
  const t = useTranslations("Banner.tabs");
  const [tab, setTab] = useState<BannerTab>(defaultTab);
  // A locked secondary tab can never be the open one
  const value: BannerTab = secondaryLocked ? "main" : tab;

  function onValueChange(next: unknown) {
    const chosen: BannerTab = next === "secondary" ? "secondary" : "main";
    setTab(chosen);
    const url = new URL(window.location.href);
    if (chosen === "secondary") url.searchParams.set("tab", "secondary");
    else url.searchParams.delete("tab");
    window.history.replaceState(null, "", url);
  }

  return (
    <Tabs value={value} onValueChange={onValueChange} className="gap-6">
      <div className="flex flex-col gap-2 border-b">
        <TabsList variant="line" aria-label={t("label")} className="justify-start">
          <TabsTrigger value="main" className="flex-none px-3">
            {t("main")}
          </TabsTrigger>
          <TabsTrigger
            value="secondary"
            disabled={secondaryLocked}
            aria-describedby={secondaryLocked ? "banner-secondary-locked" : undefined}
            className="flex-none px-3"
          >
            {secondaryLocked && <LockIcon aria-hidden />}
            {t("secondary")}
          </TabsTrigger>
        </TabsList>
        {secondaryLocked && (
          <p id="banner-secondary-locked" className="pb-2 text-xs text-muted-foreground">
            {t("locked")}
          </p>
        )}
      </div>
      <TabsContent value="main">{main}</TabsContent>
      <TabsContent value="secondary">{secondary}</TabsContent>
    </Tabs>
  );
}
