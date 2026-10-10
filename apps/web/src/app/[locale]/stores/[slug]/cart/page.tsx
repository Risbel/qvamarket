import { getTranslations, setRequestLocale } from "next-intl/server";
import { CartView } from "./cart-view";

export async function generateMetadata() {
  const t = await getTranslations("Store.cart");
  return { title: t("title") };
}

export default async function CartPage({ params }: PageProps<"/[locale]/stores/[slug]/cart">) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations("Store.cart");

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CartView />
    </main>
  );
}
