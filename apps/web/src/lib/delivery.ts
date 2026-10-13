import type { DELIVERY_FEE_MODES as DB_DELIVERY_FEE_MODES } from "@qvashop/db/schema";
import type { LatLng, LngLat } from "./map";

// Delivery fee rules (pure: shared by the settings preview, checkout and tests).

export const DELIVERY_FEE_MODES = ["free", "flat", "distance"] as const satisfies typeof DB_DELIVERY_FEE_MODES;
export type DeliveryFeeMode = (typeof DELIVERY_FEE_MODES)[number];

/** A store's delivery amounts in one currency (minor units). */
export type DeliveryRate = {
  baseFeeMinor: number;
  perKmMinor: number;
  /** subtotal from which delivery is free; null = never */
  freeAboveMinor: number | null;
  /** smallest subtotal accepted for delivery; null = no minimum */
  minOrderMinor: number | null;
};

export type DeliveryQuote =
  | { ok: true; feeMinor: number; /** free because the subtotal reached `freeAboveMinor` */ freeAbove: boolean }
  | { ok: false; reason: "belowMinimum"; minOrderMinor: number }
  /** flat/distance mode without amounts in this currency: no delivery in it */
  | { ok: false; reason: "noRate" };

/**
 * The delivery fee of an order:
 *  - below the minimum order: refused;
 *  - free mode, or subtotal >= "free above": 0;
 *  - flat: the base fee;
 *  - distance: the base fee covers `baseDistanceM`; each started km beyond it adds `perKmMinor`
 *    (1.2 km over = 2 km charged).
 */
export function deliveryFee(
  settings: { mode: DeliveryFeeMode; baseDistanceM: number },
  rate: DeliveryRate | null,
  distanceM: number,
  subtotalMinor: number,
): DeliveryQuote {
  if (!rate && settings.mode !== "free") return { ok: false, reason: "noRate" };
  if (rate?.minOrderMinor && subtotalMinor < rate.minOrderMinor) {
    return { ok: false, reason: "belowMinimum", minOrderMinor: rate.minOrderMinor };
  }
  if (settings.mode === "free" || !rate) return { ok: true, feeMinor: 0, freeAbove: false };
  if (rate.freeAboveMinor !== null && subtotalMinor >= rate.freeAboveMinor) return { ok: true, feeMinor: 0, freeAbove: true };
  if (settings.mode === "flat") return { ok: true, feeMinor: rate.baseFeeMinor, freeAbove: false };
  const extraKm = Math.ceil(Math.max(0, distanceM - settings.baseDistanceM) / 1000);
  return { ok: true, feeMinor: rate.baseFeeMinor + extraKm * rate.perKmMinor, freeAbove: false };
}

const EARTH_RADIUS_M = 6_371_008.8;

/** Straight-line (great-circle) distance in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Is the point inside the polygon ([lng, lat] corners, not closed)? Ray casting (even-odd),
 * fine at city scale where the earth is flat enough.
 */
export function insideArea(point: LatLng, area: LngLat[]): boolean {
  if (area.length < 3) return false;
  let inside = false;
  for (let i = 0, j = area.length - 1; i < area.length; j = i++) {
    const [xi, yi] = area[i];
    const [xj, yj] = area[j];
    if (yi > point.lat !== yj > point.lat && point.lng < ((xj - xi) * (point.lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
