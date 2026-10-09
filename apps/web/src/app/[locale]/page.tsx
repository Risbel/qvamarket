import { useTranslations } from "next-intl";
import { setRequestLocale } from "next-intl/server";
import { use } from "react";
import { Link } from "@/i18n/navigation";
import { buttonVariants } from "@/components/ui/button";

export default function HomePage({ params }: PageProps<"/[locale]">) {
  const { locale } = use(params);
  setRequestLocale(locale);
  const t = useTranslations("Home");

  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 p-4 text-center">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("subtitle")}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-3">
        <Link href="/signup" className={buttonVariants()}>
          {t("createStore")}
        </Link>
        <Link href="/login" className={buttonVariants({ variant: "outline" })}>
          {t("signIn")}
        </Link>
      </div>
    </main>
  );
}
