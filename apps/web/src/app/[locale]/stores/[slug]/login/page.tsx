import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { safeNextPath } from "@/lib/validation/customer-account";
import { getPublicStoreBySlug } from "@/server/public-store";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CustomerLoginForm } from "./customer-login-form";

export async function generateMetadata() {
  const t = await getTranslations("Store.account.login");
  return { title: t("title"), robots: { index: false } };
}

export default async function CustomerLoginPage({ params, searchParams }: PageProps<"/[locale]/stores/[slug]/login">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const store = await getPublicStoreBySlug(slug);
  if (!store) notFound();
  const next = safeNextPath((await searchParams).next);

  const session = await auth.api.getSession({ headers: await headers() });
  if (session) redirect({ href: next, locale });

  const t = await getTranslations("Store.account.login");
  return (
    <main className="flex flex-1 items-start justify-center px-4 py-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t("title")}</CardTitle>
          <CardDescription>{t("description", { store: store.name })}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <CustomerLoginForm next={next} />
          <p className="text-sm text-muted-foreground">
            {t("noAccount")}{" "}
            <Link href={{ pathname: "/signup", query: { next } }} className="font-medium text-foreground underline underline-offset-4">
              {t("signUp")}
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
