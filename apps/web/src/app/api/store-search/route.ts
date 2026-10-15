import type { NextRequest } from "next/server";
import { getStoreSlug } from "@/lib/tenancy";
import { SEARCH_QUERY_MAX, SUGGEST_MAX_ITEMS, SUGGEST_MIN_CHARS, type SearchSuggestResponse } from "@/lib/search";
import { searchPublicCatalog } from "@/server/public-catalog";
import { getPublicStoreBySlug } from "@/server/public-store";
import { createRateLimiter } from "@/server/rate-limit";
import { clientIp } from "@/server/request";
import { publicUrl } from "@/server/storage";
import { selectedCurrency } from "@/server/storefront-currency";

// Same budget as the cart pricing: the field debounces, so typing uses a few per word
const limiter = createRateLimiter({ limit: 120, windowMs: 60_000 });

/**
 * GET /api/store-search?q=...: suggestions for the storefront search field, as the shopper
 * types. A GET route rather than a Server Action: the browser can abort a stale request and
 * cache a repeated one. /api is outside the proxy, so the store is the request's Host
 * (never a parameter): only that store's active products, priced in the shopper's currency.
 */
export async function GET(request: NextRequest) {
  const slug = getStoreSlug(request.headers.get("host"), process.env.ROOT_DOMAIN ?? "localhost");
  const store = slug ? await getPublicStoreBySlug(slug) : null;
  if (!store) return new Response(null, { status: 404 });

  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, SEARCH_QUERY_MAX);
  const currency = await selectedCurrency(store.currencies);
  const body: SearchSuggestResponse = { currency: currency.code, items: [] };
  if (q.length >= SUGGEST_MIN_CHARS) {
    if (!limiter.tryConsume(clientIp(request.headers))) return new Response(null, { status: 429 });
    const results = await searchPublicCatalog(store.id, currency.code, q, SUGGEST_MAX_ITEMS);
    body.items = results.map((p) => ({
      slug: p.slug,
      name: p.name,
      imageUrl: p.imageKey ? publicUrl(p.imageKey) : null,
      unitMinor: p.price.unitMinor,
      compareAtMinor: p.price.compareAtMinor,
      priceVaries: p.priceVaries,
    }));
  }

  return Response.json(body, {
    // Per shopper (the currency is a cookie), briefly: prices and stock change
    headers: { "Cache-Control": "private, max-age=30", Vary: "Cookie" },
  });
}
