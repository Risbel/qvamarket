import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import type { NextRequest } from "next/server";
import { routing } from "@/i18n/routing";
import { getStoreSlug } from "@/lib/tenancy";
import { renderProductOg } from "@/server/product-og";
import { getPublicProduct } from "@/server/public-catalog";
import { getPublicStoreBySlug } from "@/server/public-store";
import { createRateLimiter } from "@/server/rate-limit";
import { clientIp } from "@/server/request";

// Drawing a card costs CPU; link previews are fetched once per share and then cached
const limiter = createRateLimiter({ limit: 60, windowMs: 60_000 });

/**
 * GET /api/og/product/<product-slug>?locale=es&v=<hash>: the product's Open Graph image
 * (link previews in WhatsApp, Facebook, Telegram...). /api is outside the proxy, so the store
 * is the request's Host (never a parameter), and only active products of an active store are
 * drawn. Priced in the store's default currency: crawlers carry no currency cookie. `v` only
 * busts caches (see productOgVersion).
 */
export async function GET(request: NextRequest, { params }: RouteContext<"/api/og/product/[slug]">) {
  const slug = getStoreSlug(request.headers.get("host"), process.env.ROOT_DOMAIN ?? "localhost");
  const store = slug ? await getPublicStoreBySlug(slug) : null;
  if (!store) return new Response(null, { status: 404 });

  if (!limiter.tryConsume(clientIp(request.headers))) return new Response(null, { status: 429 });

  const { slug: productSlug } = await params;
  const product = await getPublicProduct(store.id, productSlug, store.defaultCurrency.code);
  if (!product) return new Response(null, { status: 404 });

  const param = request.nextUrl.searchParams.get("locale");
  const locale = hasLocale(routing.locales, param) ? param : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "Store.catalog" });
  const image = await renderProductOg(store, product, locale, {
    from: t("from"),
    sale: t("sale"),
    domain: `${store.slug}.${process.env.ROOT_DOMAIN ?? "localhost"}`,
  });

  return new Response(new Uint8Array(image), {
    headers: {
      "Content-Type": "image/jpeg",
      // The URL changes with whatever the card shows (`v`), so a day is safe
      "Cache-Control": "public, max-age=86400",
    },
  });
}
