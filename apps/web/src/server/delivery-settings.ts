import { and, db, eq, store, storeDelivery } from "@qvashop/db";
import type { DeliveryAreaValues } from "@/lib/validation/delivery";

// Home delivery settings of the merchant's store (1:1 row, created on first save). Every
// query matches tenant_id AND store_id (from requireMerchant(), never from client input).

type Scope = { tenantId: string; storeId: string };

export async function getDeliverySettings({ tenantId, storeId }: Scope) {
  const [row] = await db
    .select({ locationLat: storeDelivery.locationLat, locationLng: storeDelivery.locationLng, serviceArea: storeDelivery.serviceArea })
    .from(storeDelivery)
    .where(and(eq(storeDelivery.storeId, storeId), eq(storeDelivery.tenantId, tenantId)))
    .limit(1);
  return {
    location: row && row.locationLat !== null && row.locationLng !== null ? { lat: row.locationLat, lng: row.locationLng } : null,
    area: row?.serviceArea ?? [],
  };
}

/** Saves the store's location and service area. false when the store is not this tenant's. */
export async function saveDeliveryArea({ tenantId, storeId }: Scope, values: DeliveryAreaValues): Promise<boolean> {
  const [owned] = await db
    .select({ id: store.id })
    .from(store)
    .where(and(eq(store.id, storeId), eq(store.tenantId, tenantId)))
    .limit(1);
  if (!owned) return false;
  const fields = {
    locationLat: values.location?.lat ?? null,
    locationLng: values.location?.lng ?? null,
    serviceArea: values.area.length > 0 ? values.area : null,
  };
  await db
    .insert(storeDelivery)
    .values({ storeId, tenantId, ...fields })
    .onConflictDoUpdate({ target: storeDelivery.storeId, set: fields });
  return true;
}
