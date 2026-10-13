import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link, redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";
import { ensureCustomer } from "@/server/customer-accounts";
import { getPublicStoreBySlug } from "@/server/public-store";
import { SignOutButton } from "./sign-out-button";

export async function generateMetadata() {
  const t = await getTranslations("Store.account");
  return { title: t("title"), robots: { index: false } };
}

/** The shopper's account on this store: their details. Their orders are at /account/orders. */
export default async function AccountPage({ params }: PageProps<"/[locale]/stores/[slug]/account">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);
  const store = await getPublicStoreBySlug(slug);
  if (!store) notFound();

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return redirect({ href: { pathname: "/login", query: { next: "/account" } }, locale });
  // Covers a session started without our sign-in (e.g. Better Auth's own endpoint)
  await ensureCustomer(store.id, session.user);

  const t = await getTranslations("Store.account");
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      <section className="flex flex-col gap-1 rounded-lg border p-4 text-sm" aria-labelledby="profile-title">
        <h2 id="profile-title" className="sr-only">
          {t("profile")}
        </h2>
        <p className="text-base font-medium">{session.user.name}</p>
        <p className="text-muted-foreground">{session.user.email}</p>
      </section>
      <p className="text-sm text-muted-foreground">{t("sharedAccount", { store: store.name })}</p>
      <div className="flex flex-wrap items-center gap-3">
        <SignOutButton />
        <Link href="/account/orders" className="text-sm font-medium underline underline-offset-4">
          {t("orders.title")}
        </Link>
        <Link href="/" className="text-sm font-medium underline underline-offset-4">
          {t("continueShopping")}
        </Link>
      </div>
    </main>
  );
}
