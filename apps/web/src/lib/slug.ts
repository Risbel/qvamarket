/** "Tienda Pérez & Hijos" -> "tienda-perez-hijos" (suggestion only; validated separately) */
export function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
}

/**
 * Identifier of a category, used as its section anchor on the storefront (#ropa-de-verano):
 * generated from the name, with "-2", "-3"... when another category of the store already has
 * it, and "categoria" for a name without letters or digits. `taken`: the store's other slugs.
 */
export function categorySlug(name: string, taken: Iterable<string>): string {
  const base = slugify(name) || "categoria";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) {
    if (!used.has(`${base}-${n}`)) return `${base}-${n}`;
  }
}
