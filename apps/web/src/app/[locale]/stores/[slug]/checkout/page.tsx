import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { auth } from "@/lib/auth";
import { isPhoneCountryCode, phoneCountryOptions } from "@/lib/countries";
import { ensureCustomer } from "@/server/customer-accounts";
import { getPublicDelivery } from "@/server/public-delivery";
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
  // Signed in on this store: prefill from the account's customer record
  const session = await auth.api.getSession({ headers: await headers() });
  const record = session ? await ensureCustomer(store.id, session.user) : null;
  const options = await getPublicDelivery(store.id);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <CheckoutForm
        pickup={{ address: store.address, instructions: store.pickupInstructions }}
        options={options}
        countries={phoneCountryOptions(locale)}
        defaultCountry={isPhoneCountryCode(store.phoneCountry) ? store.phoneCountry : ""}
        account={
          session && record
            ? { name: record.name, email: record.email ?? session.user.email, phone: record.phone ?? "" }
            : null
        }
      />
    </main>
  );
}
