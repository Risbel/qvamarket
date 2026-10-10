import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { getPublicStoreBySlug } from "@/server/public-store";
import { CheckoutForm } from "./checkout-form";

export async function generateMetadata() {
  const t = await getTranslations("Store.checkout");
  return { title: t("title"), robots: { index: false } };
}

export default async function CheckoutPage({ params }: PageProps<"/[locale]/stores/[slug]/checkout">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const store = await getPublicStoreBySlug(slug);
  if (!store) notFound();
  const t = await getTranslations("Store.checkout");

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CheckoutForm pickup={{ address: store.address, instructions: store.pickupInstructions }} />
    </main>
  );
}
