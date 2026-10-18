import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { z } from "zod";
import { Link, redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { invitationPath } from "@/lib/invitations";
import { LocalDateTime } from "@/components/local-date-time";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { viewInvitation } from "@/server/invitations";
import { requireUser } from "@/server/session";
import { InviteResponse, SwitchAccountButton } from "./invite-response";

/**
 * An invitation link (sent by a company to an existing account). The person signs in with
 * their own account, sees which company and role, and accepts or declines.
 */
export default async function InvitePage({ params }: PageProps<"/[locale]/invite/[id]">) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  if (!z.uuid().safeParse(id).success) notFound();
  const path = invitationPath(id.toLowerCase());

  // Not signed in: sign in first, then come back here
  const current = await auth.api.getSession({ headers: await headers() });
  if (!current) redirect({ href: `/login?next=${encodeURIComponent(path)}`, locale });
  // Temporary password pending -> change it first (requireUser redirects)
  const session = await requireUser(locale);
  if (session.session.impersonatedBy) notFound();

  const t = await getTranslations("Invite");
  const view = await viewInvitation(id.toLowerCase(), session.user);

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-md">
        {view.state === "open" ? (
          <>
            <CardHeader>
              <CardTitle>{t("title", { company: view.companyName })}</CardTitle>
              <CardDescription>
                {t("description", { inviter: view.inviterName, company: view.companyName, role: view.roleName })}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="text-sm text-muted-foreground">
                {t("signedInAs", { email: session.user.email })} · {t("expires")}{" "}
                <LocalDateTime iso={view.expiresAt.toISOString()} locale={locale} />
              </p>
              <InviteResponse id={id.toLowerCase()} companyName={view.companyName} />
            </CardContent>
          </>
        ) : view.state === "wrongEmail" ? (
          <>
            <CardHeader>
              <CardTitle>{t("wrongEmailTitle")}</CardTitle>
              <CardDescription>
                {t("wrongEmail", { invited: view.email, email: session.user.email })}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SwitchAccountButton next={path} />
            </CardContent>
          </>
        ) : view.state === "alreadyMember" ? (
          <>
            <CardHeader>
              <CardTitle>{t("alreadyMemberTitle")}</CardTitle>
              <CardDescription>{t("alreadyMember", { company: view.companyName })}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/dashboard" className={buttonVariants()}>
                {t("toPanel")}
              </Link>
            </CardContent>
          </>
        ) : (
          <>
            <CardHeader>
              <CardTitle>{t("closedTitle")}</CardTitle>
              <CardDescription>{t("closed")}</CardDescription>
            </CardHeader>
            <CardContent>
              <Link href="/dashboard" className={buttonVariants({ variant: "outline" })}>
                {t("toPanel")}
              </Link>
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
