import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { formatMoney } from "@/lib/money";
import { listPublicProducts } from "@/server/public-catalog";
import { getPublicStoreBySlug } from "@/server/public-store";
import { publicUrl } from "@/server/storage";

export default async function StoreCatalogPage({
  params,
}: PageProps<"/[locale]/stores/[slug]">) {
  const { locale, slug } = await params;
  setRequestLocale(locale);

  const store = await getPublicStoreBySlug(slug);
  if (!store) notFound();
  const t = await getTranslations("Store.catalog");
  const products = await listPublicProducts(store.id);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>

      {products.length === 0 ? (
        <p className="text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {products.map((product, index) => {
            const soldOut = product.stock === 0;
            return (
              <li key={product.id}>
                <Link
                  href={`/products/${product.id}`}
                  className="group flex flex-col gap-2 rounded-lg outline-offset-4 focus-visible:outline-2"
                >
                  <div className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
                    {product.imageKey ? (
                      // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
                      <img
                        src={publicUrl(product.imageKey)}
                        alt={product.name}
                        width={400}
                        height={400}
                        loading={index < 4 ? "eager" : "lazy"}
                        className={`size-full object-cover transition-transform group-hover:scale-105 ${soldOut ? "opacity-60" : ""}`}
                      />
                    ) : (
                      <div className="flex size-full items-center justify-center text-xs text-muted-foreground">
                        {t("noImage")}
                      </div>
                    )}
                    {soldOut && (
                      <span
                        className="absolute left-2 top-2 rounded-full px-2.5 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: "var(--brand-accent)",
                          color: "var(--brand-accent-foreground)",
                        }}
                      >
                        {t("soldOut")}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium leading-snug">{product.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatMoney(product.priceMinor, store.currency, locale)}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
