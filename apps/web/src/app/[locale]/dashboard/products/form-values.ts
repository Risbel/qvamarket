import { minorToInput } from "@/lib/money";
import type { FormCurrency, PricesFormValues, ProductFormValues } from "@/lib/validation/product";

type SavedPrice = { currencyCode: string; minQuantity: number; amountMinor: number; compareAtMinor: number | null };

/** Saved regular price rows -> one form entry per currency the store sells in. */
export function pricesToFormValues(rows: SavedPrice[], currencies: FormCurrency[]): PricesFormValues {
  return currencies.map((c) => {
    const own = rows.filter((p) => p.currencyCode === c.code);
    const regular = own.find((p) => p.minQuantity === 1);
    return {
      currency: c.code,
      price: regular ? minorToInput(regular.amountMinor, c.digits) : "",
      compareAt: regular?.compareAtMinor != null ? minorToInput(regular.compareAtMinor, c.digits) : "",
      tiers: own
        .filter((p) => p.minQuantity > 1)
        .map((p) => ({ minQuantity: String(p.minQuantity), price: minorToInput(p.amountMinor, c.digits) })),
    };
  });
}

const emptyPrices = (currencies: FormCurrency[]): ProductFormValues["prices"] =>
  currencies.map((c) => ({ currency: c.code, price: "", compareAt: "", tiers: [] }));

export function emptyProductValues(currencies: FormCurrency[]): ProductFormValues {
  return {
    name: "",
    description: "",
    status: "draft",
    slug: "",
    categoryId: "",
    tags: "",
    metaTitle: "",
    metaDescription: "",
    sku: "",
    stock: "",
    prices: emptyPrices(currencies),
    images: [],
  };
}

type SavedProduct = {
  name: string;
  description: string | null;
  status: string;
  slug: string;
  categoryId: string | null;
  tags: string[];
  metaTitle: string | null;
  metaDescription: string | null;
  defaultVariant: { sku: string | null; stock: number | null } | null;
  hasOptions: boolean;
  prices: SavedPrice[];
};

/**
 * Saved product -> form strings. One prices entry per currency the store sells in; none for a
 * product with options (its prices belong to the variants form). `imageIds`: its images, main first.
 */
export function productToFormValues(
  saved: SavedProduct,
  currencies: FormCurrency[],
  imageIds: string[],
): ProductFormValues {
  return {
    name: saved.name,
    description: saved.description ?? "",
    status: saved.status as ProductFormValues["status"],
    slug: saved.slug,
    categoryId: saved.categoryId ?? "",
    tags: saved.tags.join(", "),
    metaTitle: saved.metaTitle ?? "",
    metaDescription: saved.metaDescription ?? "",
    sku: saved.defaultVariant?.sku ?? "",
    stock: saved.defaultVariant?.stock == null ? "" : String(saved.defaultVariant.stock),
    prices: saved.hasOptions ? [] : pricesToFormValues(saved.prices, currencies),
    images: imageIds.map((id) => ({ kind: "existing", id })),
  };
}
