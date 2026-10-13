import { randomUUID } from "node:crypto";
import { and, asc, count, db, eq, sql, store, storeBannerImage, storeSecondaryBannerPair } from "@qvashop/db";
import {
  checkImageBytes,
  extensionFor,
  MAX_SECONDARY_BANNER_PAIRS,
  type BannerDevice,
  type ImageCheck,
  type SecondaryBannerSide,
} from "@/lib/images";
import { deleteObject, putObject, tenantKey } from "./storage";

// Secondary banner: pairs of tiles under the hero (rows in `store_secondary_banner_pair`, one
// per slide, each side filled separately) + files under
// tenants/<tenantId>/stores/<storeId>/banner/secondary/. Same rules as store-banner.ts: the
// tenant and store come from getMerchantOrNull()/requireMerchant(), pair ids from the client
// are only matched together with them, and every write locks the store row (limit, positions).

type Scope = { tenantId: string; storeId: string };
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type SecondaryBannerError =
  | Extract<ImageCheck, { ok: false }>["error"]
  | "notFound"
  | "limit"
  | "needsHero";

const pair = storeSecondaryBannerPair;

const inScope = ({ tenantId, storeId }: Scope) => and(eq(pair.tenantId, tenantId), eq(pair.storeId, storeId));

const SIDE_KEY = { left: pair.leftStorageKey, right: pair.rightStorageKey } as const;

/** Pairs of both devices, each list in display order. A missing side has a null key. */
export async function listSecondaryPairs(scope: Scope) {
  return db
    .select({
      id: pair.id,
      device: pair.device,
      leftStorageKey: pair.leftStorageKey,
      leftSizeBytes: pair.leftSizeBytes,
      rightStorageKey: pair.rightStorageKey,
      rightSizeBytes: pair.rightSizeBytes,
    })
    .from(pair)
    .where(inScope(scope))
    .orderBy(asc(pair.position), asc(pair.createdAt));
}

/** Whether the store's banner shows the secondary section (the merchant's on/off switch). */
export async function getSecondaryBannerVisible({ tenantId, storeId }: Scope) {
  const [row] = await db
    .select({ visible: store.secondaryBannerVisible })
    .from(store)
    .where(and(eq(store.id, storeId), eq(store.tenantId, tenantId)))
    .limit(1);
  return row?.visible ?? false;
}

/** Locks the store row: serializes every write to the secondary banner of one store. */
async function lockStore(tx: Tx, { tenantId, storeId }: Scope) {
  const [row] = await tx
    .select({ id: store.id })
    .from(store)
    .where(and(eq(store.id, storeId), eq(store.tenantId, tenantId)))
    .for("no key update")
    .limit(1);
  return Boolean(row);
}

/** The pairs of one device, in display order. */
async function deviceIds(tx: Tx, scope: Scope, device: BannerDevice) {
  const rows = await tx
    .select({ id: pair.id })
    .from(pair)
    .where(and(inScope(scope), eq(pair.device, device)))
    .orderBy(asc(pair.position), asc(pair.createdAt));
  return rows.map((row) => row.id);
}

async function setPositions(tx: Tx, scope: Scope, orderedIds: string[]) {
  for (const [position, id] of orderedIds.entries()) {
    await tx.update(pair).set({ position }).where(and(inScope(scope), eq(pair.id, id)));
  }
}

const dropFile = (key: string | null) =>
  key
    ? deleteObject(key).catch((error) => console.error("secondary banner: could not delete file", key, error))
    : Promise.resolve();

/**
 * Appends an empty pair to a device's list. The secondary banner only exists on top of a
 * main banner, so this is refused while the store has no hero images.
 */
export async function createSecondaryPair(
  scope: Scope,
  device: BannerDevice,
): Promise<{ ok: true; id: string } | { ok: false; error: SecondaryBannerError }> {
  return db.transaction(async (tx) => {
    if (!(await lockStore(tx, scope))) return { ok: false, error: "notFound" } as const;

    const [hero] = await tx
      .select({ total: count() })
      .from(storeBannerImage)
      .where(and(eq(storeBannerImage.tenantId, scope.tenantId), eq(storeBannerImage.storeId, scope.storeId)));
    if (hero.total === 0) return { ok: false, error: "needsHero" } as const;

    const [stats] = await tx
      .select({ total: count(), next: sql<number>`coalesce(max(${pair.position}) + 1, 0)` })
      .from(pair)
      .where(and(inScope(scope), eq(pair.device, device)));
    if (stats.total >= MAX_SECONDARY_BANNER_PAIRS) return { ok: false, error: "limit" } as const;

    const [row] = await tx
      .insert(pair)
      .values({ tenantId: scope.tenantId, storeId: scope.storeId, device, position: Number(stats.next) })
      .returning({ id: pair.id });
    return { ok: true, id: row.id } as const;
  });
}

/**
 * Sets (or replaces) one side of a pair. The new file goes first, so a row never points at a
 * missing file; the replaced file is deleted after the row is updated.
 */
export async function setSecondaryPairImage(
  scope: Scope,
  pairId: string,
  side: SecondaryBannerSide,
  bytes: Uint8Array,
): Promise<{ ok: true } | { ok: false; error: SecondaryBannerError }> {
  const check = checkImageBytes(bytes);
  if (!check.ok) return check;

  const key = tenantKey(
    scope.tenantId,
    "stores",
    scope.storeId,
    "banner",
    "secondary",
    `${randomUUID()}.${extensionFor(check.type)}`,
  );
  await putObject({ key, body: bytes, contentType: check.type });

  try {
    const previous = await db.transaction(async (tx) => {
      if (!(await lockStore(tx, scope))) return null;
      const [row] = await tx
        .select({ key: SIDE_KEY[side] })
        .from(pair)
        .where(and(inScope(scope), eq(pair.id, pairId)))
        .limit(1);
      if (!row) return null;
      await tx
        .update(pair)
        .set(
          side === "left"
            ? { leftStorageKey: key, leftContentType: check.type, leftSizeBytes: bytes.length }
            : { rightStorageKey: key, rightContentType: check.type, rightSizeBytes: bytes.length },
        )
        .where(and(inScope(scope), eq(pair.id, pairId)));
      return { key: row.key };
    });

    if (!previous) {
      await dropFile(key);
      return { ok: false, error: "notFound" };
    }
    await dropFile(previous.key);
    return { ok: true };
  } catch (error) {
    await dropFile(key);
    throw error;
  }
}

/** Removes the pair (the rest of its device close the gap) and then both files. */
export async function deleteSecondaryPair(
  scope: Scope,
  pairId: string,
): Promise<{ ok: true } | { ok: false; error: "notFound" }> {
  const removed = await db.transaction(async (tx) => {
    if (!(await lockStore(tx, scope))) return null;
    const [row] = await tx
      .delete(pair)
      .where(and(inScope(scope), eq(pair.id, pairId)))
      .returning({ device: pair.device, left: pair.leftStorageKey, right: pair.rightStorageKey });
    if (!row) return null;
    await setPositions(tx, scope, await deviceIds(tx, scope, row.device as BannerDevice));
    return row;
  });
  if (!removed) return { ok: false, error: "notFound" };

  // After the rows: a storage failure leaves an orphan file, never a row without a file
  await Promise.all([dropFile(removed.left), dropFile(removed.right)]);
  return { ok: true };
}

/** Swaps the pair with its neighbour on the same device; positions are rewritten as 0..n-1. */
export async function moveSecondaryPair(
  scope: Scope,
  pairId: string,
  direction: "up" | "down",
): Promise<{ ok: true } | { ok: false; error: "notFound" }> {
  return db.transaction(async (tx) => {
    if (!(await lockStore(tx, scope))) return { ok: false, error: "notFound" } as const;
    const [row] = await tx
      .select({ device: pair.device })
      .from(pair)
      .where(and(inScope(scope), eq(pair.id, pairId)))
      .limit(1);
    if (!row) return { ok: false, error: "notFound" } as const;
    const ordered = await deviceIds(tx, scope, row.device as BannerDevice);
    const index = ordered.indexOf(pairId);
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= ordered.length) return { ok: true } as const;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    await setPositions(tx, scope, ordered);
    return { ok: true } as const;
  });
}

/** The merchant's on/off switch. false when the store is not in this tenant. */
export async function setSecondaryBannerVisible({ tenantId, storeId }: Scope, visible: boolean) {
  const rows = await db
    .update(store)
    .set({ secondaryBannerVisible: visible })
    .where(and(eq(store.id, storeId), eq(store.tenantId, tenantId)))
    .returning({ id: store.id });
  return rows.length === 1;
}
