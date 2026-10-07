import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardPage({
  params,
}: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect({ href: "/login", locale });

  const t = await getTranslations("Dashboard");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4">
      <h1 className="text-2xl font-semibold">
        {t("welcome", { name: session!.user.name })}
      </h1>
      <p className="text-muted-foreground">{session!.user.email}</p>
      <SignOutButton />
    </main>
  );
}
