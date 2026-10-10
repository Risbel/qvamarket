import { minorToInput } from "@/lib/money";
import type { FormCurrency, ProductFormValues } from "@/lib/validation/product";

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
  prices: { currencyCode: string; minQuantity: number; amountMinor: number; compareAtMinor: number | null }[];
};

/** Saved product -> form strings. One prices entry per currency the store sells in. */
export function productToFormValues(saved: SavedProduct, currencies: FormCurrency[]): ProductFormValues {
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
    prices: currencies.map((c) => {
      const rows = saved.prices.filter((p) => p.currencyCode === c.code);
      const regular = rows.find((p) => p.minQuantity === 1);
      return {
        currency: c.code,
        price: regular ? minorToInput(regular.amountMinor, c.digits) : "",
        compareAt: regular?.compareAtMinor != null ? minorToInput(regular.compareAtMinor, c.digits) : "",
        tiers: rows
          .filter((p) => p.minQuantity > 1)
          .map((p) => ({ minQuantity: String(p.minQuantity), price: minorToInput(p.amountMinor, c.digits) })),
      };
    }),
  };
}
