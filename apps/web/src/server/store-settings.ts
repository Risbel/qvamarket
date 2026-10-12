import { and, db, eq, store } from "@qvashop/db";
import type { PickupValues, StoreProfileValues } from "@/lib/validation/catalog-settings";

type Scope = { tenantId: string; storeId: string };
const owns = ({ tenantId, storeId }: Scope) => and(eq(store.id, storeId), eq(store.tenantId, tenantId));

export async function getStoreProfile(scope: Scope) {
  const [row] = await db
    .select({
      description: store.description,
      phone: store.phone,
      whatsapp: store.whatsapp,
      contactEmail: store.contactEmail,
      address: store.address,
      phoneCountry: store.phoneCountry,
      pickupInstructions: store.pickupInstructions,
      metaTitle: store.metaTitle,
      metaDescription: store.metaDescription,
    })
    .from(store)
    .where(owns(scope))
    .limit(1);
  return row ?? null;
}

const orNull = (value: string) => (value === "" ? null : value);

/** Saves the public profile; empty fields are stored as NULL. */
export async function updateStoreProfile(scope: Scope, values: StoreProfileValues) {
  const rows = await db
    .update(store)
    .set({
      description: orNull(values.description),
      phone: orNull(values.phone),
      whatsapp: orNull(values.whatsapp),
      contactEmail: orNull(values.contactEmail),
      address: orNull(values.address),
      phoneCountry: orNull(values.phoneCountry),
      metaTitle: orNull(values.metaTitle),
      metaDescription: orNull(values.metaDescription),
    })
    .where(owns(scope))
    .returning({ id: store.id });
  return rows.length === 1;
}

/** Saves the pickup settings; empty fields are stored as NULL. */
export async function updatePickupSettings(scope: Scope, values: PickupValues) {
  const rows = await db
    .update(store)
    .set({ pickupInstructions: orNull(values.pickupInstructions) })
    .where(owns(scope))
    .returning({ id: store.id });
  return rows.length === 1;
}
