// Turning a product's options into variants, as pure functions (no database).

export type PlanOption = { values: { id: string; value: string }[] };

export type Combination = {
  /** one option value id per option, in option order */
  valueIds: string[];
  /** stable identity of the combination: the sorted value ids (product_variant.option_key) */
  key: string;
  /** label shown to customers, e.g. "M / Rojo" */
  title: string;
};

export type ExistingVariant = { id: string; valueIds: string[] };

export type VariantPlan = {
  /** existing variants that stay, possibly with a new combination (prices and stock are kept) */
  keep: { variantId: string; combination: Combination; position: number; changed: boolean }[];
  /** combinations that need a new variant */
  create: { combination: Combination; position: number }[];
  /** existing variants that no longer match any combination */
  remove: string[];
};

export const optionKey = (valueIds: string[]) => [...valueIds].sort().join(",");

/** Every combination of the options' values (cartesian product), first option varying slowest. */
export function combinations(options: PlanOption[]): Combination[] {
  if (options.length === 0) return [];
  let result: { valueIds: string[]; labels: string[] }[] = [{ valueIds: [], labels: [] }];
  for (const option of options) {
    result = result.flatMap((partial) =>
      option.values.map((v) => ({ valueIds: [...partial.valueIds, v.id], labels: [...partial.labels, v.value] })),
    );
  }
  return result.map((c) => ({ valueIds: c.valueIds, key: optionKey(c.valueIds), title: c.labels.join(" / ") }));
}

const isSubset = (a: Set<string>, b: Set<string>) => [...a].every((id) => b.has(id));

/**
 * Matches the existing variants (in their current order) to the new combinations so the
 * merchant's prices and stock survive edits of the options:
 *  1. same combination (a renamed value keeps its id) -> the variant stays as it is;
 *  2. otherwise a variant moves to the first free combination that contains all its values or
 *     whose values it all contains. So adding an option ("Color") moves "M" to "M / <first
 *     color>", removing an option moves "M / Rojo" to "M", and the default variant of a simple
 *     product (no values) becomes the first combination;
 *  3. combinations left get new variants; variants left are removed.
 */
export function planVariants(options: PlanOption[], existing: ExistingVariant[]): VariantPlan {
  const combos = combinations(options);
  const taken = new Map<number, string>(); // combination index -> variant id
  const placed = new Set<string>();

  const byKey = new Map(combos.map((c, i) => [c.key, i]));
  for (const variant of existing) {
    const index = byKey.get(optionKey(variant.valueIds));
    if (index !== undefined && !taken.has(index) && variant.valueIds.length > 0) {
      taken.set(index, variant.id);
      placed.add(variant.id);
    }
  }

  const exact = new Set(placed);
  for (const variant of existing) {
    if (placed.has(variant.id)) continue;
    const own = new Set(variant.valueIds);
    const index = combos.findIndex((c, i) => {
      if (taken.has(i)) return false;
      const other = new Set(c.valueIds);
      return isSubset(own, other) || isSubset(other, own);
    });
    if (index >= 0) {
      taken.set(index, variant.id);
      placed.add(variant.id);
    }
  }

  const plan: VariantPlan = { keep: [], create: [], remove: existing.filter((v) => !placed.has(v.id)).map((v) => v.id) };
  combos.forEach((combination, position) => {
    const variantId = taken.get(position);
    if (variantId) plan.keep.push({ variantId, combination, position, changed: !exact.has(variantId) });
    else plan.create.push({ combination, position });
  });
  return plan;
}
