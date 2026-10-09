import { headers } from "next/headers";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SignupForm } from "./signup-form";

export default async function SignupPage({ params }: PageProps<"/[locale]/signup">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect({ href: "/dashboard", locale });

  const t = await getTranslations("Signup");

  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SignupForm />
          <p className="text-sm text-muted-foreground">
            {t("haveAccount")}{" "}
            <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
              {t("signIn")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
