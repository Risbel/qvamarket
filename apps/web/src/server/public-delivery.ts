import { db, eq, storeDelivery, storeDeliveryRate } from "@qvashop/db";
import type { DeliveryFeeMode, DeliveryRate } from "@/lib/delivery";
import type { LatLng, LngLat } from "@/lib/map";

// Public view of a store's delivery settings for its storefront (checkout). Like the other
// public-*.ts reads it runs for an anonymous visitor: callers pass the id of a store already
// found through getPublicStoreBySlug (an active store), and nothing tenant-related leaves.

export type PublicDelivery = {
  pickupEnabled: boolean;
  /** null = no home delivery (off, or the map is not set up) */
  delivery: {
    mode: DeliveryFeeMode;
    baseDistanceM: number;
    /** where orders leave from (distances are measured from it) */
    location: LatLng;
    area: LngLat[];
    /** amounts per currency code; a currency missing here has no delivery in flat/distance mode */
    rates: Record<string, DeliveryRate>;
  } | null;
};

/** `executor` lets checkout read it inside its transaction (after locking the store row). */
export async function getPublicDelivery(storeId: string, executor: Pick<typeof db, "select"> = db): Promise<PublicDelivery> {
  const [row] = await executor.select().from(storeDelivery).where(eq(storeDelivery.storeId, storeId)).limit(1);
  if (!row) return { pickupEnabled: true, delivery: null };
  const ready = row.deliveryEnabled && row.locationLat !== null && row.locationLng !== null && (row.serviceArea?.length ?? 0) >= 3;
  if (!ready) return { pickupEnabled: row.pickupEnabled, delivery: null };

  const rates = await executor
    .select({
      currencyCode: storeDeliveryRate.currencyCode,
      baseFeeMinor: storeDeliveryRate.baseFeeMinor,
      perKmMinor: storeDeliveryRate.perKmMinor,
      freeAboveMinor: storeDeliveryRate.freeAboveMinor,
      minOrderMinor: storeDeliveryRate.minOrderMinor,
    })
    .from(storeDeliveryRate)
    .where(eq(storeDeliveryRate.storeId, storeId));
  return {
    pickupEnabled: row.pickupEnabled,
    delivery: {
      mode: row.feeMode as DeliveryFeeMode,
      baseDistanceM: row.baseDistanceM,
      location: { lat: row.locationLat!, lng: row.locationLng! },
      area: row.serviceArea!,
      rates: Object.fromEntries(rates.map(({ currencyCode, ...rate }) => [currencyCode, rate])),
    },
  };
}
