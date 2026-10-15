// Storefront product search: plain substring matching, ignoring case and accents, so
// "cafe" finds "Café" and "camion" finds "Camión". Catalogs are small (the home page
// already loads all of them), so the matching runs in the app, not in SQL.

export const SEARCH_QUERY_MAX = 100;

/** Suggestions while typing (GET /api/store-search): from this many characters, this many items. */
export const SUGGEST_MIN_CHARS = 2;
export const SUGGEST_MAX_ITEMS = 6;

/** One suggestion as the API sends it: public fields only, amounts in minor units. */
export type SearchSuggestion = {
  slug: string;
  name: string;
  imageUrl: string | null;
  unitMinor: number;
  compareAtMinor: number | null;
  priceVaries: boolean;
};

export type SearchSuggestResponse = { currency: string; items: SearchSuggestion[] };

/** Lowercase, without accents (ñ becomes n too: shoppers often type it without the tilde). */
export function normalizeSearchText(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/** The words of a query (normalized, duplicates removed); empty = nothing to search. */
export function searchTerms(query: string): string[] {
  const words = normalizeSearchText(query.slice(0, SEARCH_QUERY_MAX)).split(/[^\p{L}\p{N}]+/u);
  return [...new Set(words.filter(Boolean))];
}

export type SearchableProduct = {
  name: string;
  tags: string[];
  categoryName: string | null;
  description: string | null;
};

/**
 * null when some word of the query appears nowhere in the product; otherwise a score
 * (higher = better): words in the name count most, then tags and category, then the
 * description, and a name that starts with the first word gets a bonus.
 */
export function searchScore(terms: string[], product: SearchableProduct): number | null {
  if (terms.length === 0) return null;
  const name = normalizeSearchText(product.name);
  const labels = normalizeSearchText([...product.tags, product.categoryName ?? ""].join(" "));
  const description = normalizeSearchText(product.description ?? "");

  let score = name.startsWith(terms[0]) ? 2 : 0;
  for (const term of terms) {
    if (name.includes(term)) score += 4;
    else if (labels.includes(term)) score += 2;
    else if (description.includes(term)) score += 1;
    else return null;
  }
  return score;
}
