import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";
import { ImpersonationBanner } from "@/components/impersonation-banner";
import { requireUser } from "@/server/session";
import { SignOutButton } from "./sign-out-button";

export default async function DashboardPage({
  params,
}: PageProps<"/[locale]/dashboard">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await requireUser(locale);

  const t = await getTranslations("Dashboard");

  const impersonating = Boolean(session.session.impersonatedBy);

  return (
    <>
      {impersonating && <ImpersonationBanner targetEmail={session.user.email} />}
      <main className="flex flex-1 flex-col items-center justify-center gap-4">
        <h1 className="text-2xl font-semibold">
          {t("welcome", { name: session.user.name })}
        </h1>
        <p className="text-muted-foreground">{session.user.email}</p>
        {session.user.role === "admin" && (
          <Link href="/admin" className={buttonVariants()}>
            {t("admin")}
          </Link>
        )}
        {!impersonating && <SignOutButton />}
      </main>
    </>
  );
}
