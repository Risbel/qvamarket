import { getTranslations, setRequestLocale } from "next-intl/server";
import { PanelShell } from "@/components/panel-shell";
import { requireAdminPage } from "@/server/admin";

export default async function AdminLayout({
  children,
  params,
}: LayoutProps<"/[locale]/admin">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const session = await requireAdminPage(locale);
  const t = await getTranslations("Admin");
  const tMeta = await getTranslations("Metadata");

  return (
    <PanelShell
      basePath="/admin"
      groups={[{ label: "platform", items: ["merchants", "newMerchant"] }]}
      brand={{ title: tMeta("title"), subtitle: t("title"), logoUrl: null, href: "/admin" }}
      user={{ name: session.user.name, email: session.user.email }}
      // An impersonated session never reaches /admin (it is a merchant session)
      impersonating={false}
    >
      <div className="mx-auto w-full max-w-5xl flex-1 p-4">{children}</div>
    </PanelShell>
  );
}
