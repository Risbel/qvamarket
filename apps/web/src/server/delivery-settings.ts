import { and, asc, db, eq, store, storeDelivery, storeDeliveryRate } from "@qvashop/db";
import type { DeliveryFeeMode, DeliveryRate } from "@/lib/delivery";
import type { DeliveryAreaValues } from "@/lib/validation/delivery";
import type { DeliveryChargesInput } from "@/lib/validation/delivery-charges";

// Home delivery settings of the merchant's store (1:1 row, created on first save; without
// it the store offers pickup only). Every query matches tenant_id AND store_id (from
// requireMerchant(), never from client input).

type Scope = { tenantId: string; storeId: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type DeliverySaveResult = { ok: true } | { ok: false; error: "notFound" | "deliveryNeedsArea" };

const inScope = ({ tenantId, storeId }: Scope) => and(eq(storeDelivery.storeId, storeId), eq(storeDelivery.tenantId, tenantId));

export async function getDeliverySettings(scope: Scope) {
  const [[row], rates] = await Promise.all([
    db.select().from(storeDelivery).where(inScope(scope)).limit(1),
    db
      .select({
        currencyCode: storeDeliveryRate.currencyCode,
        baseFeeMinor: storeDeliveryRate.baseFeeMinor,
        perKmMinor: storeDeliveryRate.perKmMinor,
        freeAboveMinor: storeDeliveryRate.freeAboveMinor,
        minOrderMinor: storeDeliveryRate.minOrderMinor,
      })
      .from(storeDeliveryRate)
      .where(and(eq(storeDeliveryRate.storeId, scope.storeId), eq(storeDeliveryRate.tenantId, scope.tenantId)))
      .orderBy(asc(storeDeliveryRate.currencyCode)),
  ]);
  return {
    location: row && row.locationLat !== null && row.locationLng !== null ? { lat: row.locationLat, lng: row.locationLng } : null,
    area: row?.serviceArea ?? [],
    deliveryEnabled: row?.deliveryEnabled ?? false,
    pickupEnabled: row?.pickupEnabled ?? true,
    mode: (row?.feeMode ?? "flat") as DeliveryFeeMode,
    baseDistanceM: row?.baseDistanceM ?? 0,
    rates: new Map<string, DeliveryRate>(rates.map(({ currencyCode, ...rate }) => [currencyCode, rate])),
  };
}

/** Locks the store row (serializes saves) and checks it is this tenant's. */
async function lockStore(tx: Tx, { tenantId, storeId }: Scope) {
  const [owned] = await tx
    .select({ id: store.id })
    .from(store)
    .where(and(eq(store.id, storeId), eq(store.tenantId, tenantId)))
    .for("no key update");
  return !!owned;
}

/**
 * Saves the store's location and service area. While delivery is on, both must stay
 * (`deliveryNeedsArea`): switch delivery off first to remove them.
 */
export async function saveDeliveryArea(scope: Scope, values: DeliveryAreaValues): Promise<DeliverySaveResult> {
  return db.transaction(async (tx) => {
    if (!(await lockStore(tx, scope))) return { ok: false, error: "notFound" };
    const [current] = await tx.select({ deliveryEnabled: storeDelivery.deliveryEnabled }).from(storeDelivery).where(inScope(scope));
    if (current?.deliveryEnabled && (!values.location || values.area.length === 0)) return { ok: false, error: "deliveryNeedsArea" };
    const fields = {
      locationLat: values.location?.lat ?? null,
      locationLng: values.location?.lng ?? null,
      serviceArea: values.area.length > 0 ? values.area : null,
    };
    await tx
      .insert(storeDelivery)
      .values({ ...scope, ...fields })
      .onConflictDoUpdate({ target: storeDelivery.storeId, set: fields });
    return { ok: true };
  });
}

/**
 * Saves pickup/delivery on-off, the fee mode and the amounts per currency (replacing the
 * previous ones). Delivery can only be switched on once the map has a location and an area.
 */
export async function saveDeliveryCharges(scope: Scope, input: DeliveryChargesInput): Promise<DeliverySaveResult> {
  return db.transaction(async (tx) => {
    if (!(await lockStore(tx, scope))) return { ok: false, error: "notFound" };
    const [current] = await tx
      .select({ locationLat: storeDelivery.locationLat, serviceArea: storeDelivery.serviceArea })
      .from(storeDelivery)
      .where(inScope(scope));
    if (input.deliveryEnabled && (current?.locationLat == null || !current.serviceArea)) {
      return { ok: false, error: "deliveryNeedsArea" };
    }
    const fields = {
      deliveryEnabled: input.deliveryEnabled,
      pickupEnabled: input.pickupEnabled,
      feeMode: input.mode,
      baseDistanceM: input.baseDistanceM,
    };
    // Not an upsert: PostgreSQL checks CHECK constraints on the row an INSERT proposes before
    // ON CONFLICT turns it into an update, and that row has no area (delivery_enabled would
    // fail store_delivery_enabled_needs_area). Without a row, delivery is off (checked above).
    if (current) await tx.update(storeDelivery).set(fields).where(inScope(scope));
    else await tx.insert(storeDelivery).values({ ...scope, ...fields });
    await tx
      .delete(storeDeliveryRate)
      .where(and(eq(storeDeliveryRate.storeId, scope.storeId), eq(storeDeliveryRate.tenantId, scope.tenantId)));
    if (input.rates.length > 0) {
      await tx.insert(storeDeliveryRate).values(input.rates.map((rate) => ({ ...scope, ...rate })));
    }
    return { ok: true };
  });
}
