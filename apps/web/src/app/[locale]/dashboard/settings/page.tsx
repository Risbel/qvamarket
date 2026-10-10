import { redirect } from "@/i18n/navigation";

export default async function SettingsPage({ params }: PageProps<"/[locale]/dashboard/settings">) {
  const { locale } = await params;
  redirect({ href: "/dashboard/settings/general", locale });
}
