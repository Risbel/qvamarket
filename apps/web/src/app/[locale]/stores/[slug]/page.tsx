import { getTranslations, setRequestLocale } from "next-intl/server";

// Phase 0: the slug is not looked up yet. Phase 1 resolves it against the stores table.
export default async function StorePage({
  params,
}: PageProps<"/[locale]/stores/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Store");

  return (
    <main className="flex flex-1 items-center justify-center">
      <h1 className="text-3xl font-semibold">{t("hello", { slug })}</h1>
    </main>
  );
}
