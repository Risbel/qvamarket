import { storePath } from "@/lib/panel-paths";
import { redirect } from "@/i18n/navigation";

export default async function SettingsPage({ params }: PageProps<"/[locale]/dashboard/store/[storeId]/settings">) {
  const { locale, storeId } = await params;
  redirect({ href: storePath(storeId, "/settings/general"), locale });
}
