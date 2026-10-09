import { headers } from "next/headers";
import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { Link, redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { LoginForm } from "./login-form";

export default async function LoginPage({ params }: PageProps<"/[locale]/login">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect({ href: "/dashboard", locale });

  return <LoginCard />;
}

function LoginCard() {
  const t = useTranslations("Login");
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <LoginForm />
          <p className="text-sm text-muted-foreground">
            {t("noAccount")}{" "}
            <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
              {t("createStore")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
