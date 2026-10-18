import { setRequestLocale } from "next-intl/server";
import { requirePanelSection } from "@/server/tenant";
import { SettingsNav } from "./settings-nav";

/** Shared frame of the settings sections; each section page checks the permission again. */
export default async function SettingsLayout({
  children,
  params,
}: LayoutProps<"/[locale]/dashboard/settings">) {
  const { locale } = await params;
  setRequestLocale(locale);
  await requirePanelSection(locale, "settings");

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 p-4 md:grid md:grid-cols-[12rem_minmax(0,1fr)] md:items-start md:gap-8">
      <SettingsNav />
      <div className="flex min-w-0 flex-col">{children}</div>
    </div>
  );
}
