// Promotions (price lists) as the merchant sees them. Pure: shared by server and client.

/**
 * What a promotion is doing right now:
 *  - draft: saved but switched off;
 *  - scheduled: switched on, its start date is still ahead;
 *  - running: switched on and inside its dates (prices apply now);
 *  - ended: switched on but its end date has passed.
 * Matches the filter in loadPriceRows (src/server/pricing.ts): only "running" prices apply.
 */
export type PromotionState = "draft" | "scheduled" | "running" | "ended";

export function promotionState(
  status: string,
  startsAt: Date | null,
  endsAt: Date | null,
  now: Date = new Date(),
): PromotionState {
  if (status !== "active") return "draft";
  if (startsAt && startsAt > now) return "scheduled";
  if (endsAt && endsAt <= now) return "ended";
  return "running";
}

/**
 * `percent` % off a price in minor units, rounded to the nearest unit of the currency
 * (e.g. 20 % off 19.99 -> 15.99). Never below 0.
 */
export function percentOff(regularMinor: number, percent: number): number {
  return Math.max(0, Math.round((regularMinor * (100 - percent)) / 100));
}
