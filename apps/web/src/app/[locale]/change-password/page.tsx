import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SignOutButton } from "../dashboard/sign-out-button";
import { ChangePasswordForm } from "./change-password-form";

export default async function ChangePasswordPage({
  params,
}: PageProps<"/[locale]/change-password">) {
  const { locale } = await params;
  setRequestLocale(locale);

  // Deliberately not requireUser(): this is the page users with a temporary password are sent to
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect({ href: "/login", locale });

  const t = await getTranslations("ChangePassword");

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>
            {session!.user.mustChangePassword ? t("forced") : t("voluntary")}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ChangePasswordForm />
          <SignOutButton />
        </CardContent>
      </Card>
    </main>
  );
}
