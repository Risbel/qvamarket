import { randomUUID } from "node:crypto";
import { and, db, eq, store } from "@qvashop/db";
import { checkImageBytes, extensionFor, type BrandImageKind, type ImageCheck } from "@/lib/images";
import type { BrandingValues } from "@/lib/validation/branding";
import { deleteObject, putObject, tenantKey } from "./storage";

// Store branding (logo, logotype, colors). Every function matches the store id AND its tenant,
// both taken from requireMerchant()/getMerchantOrNull(), never from client input.

type Scope = { tenantId: string; storeId: string };
const owns = ({ tenantId, storeId }: Scope) =>
  and(eq(store.id, storeId), eq(store.tenantId, tenantId));

/** false when the store is not in this tenant (nothing is updated). */
export async function updateBranding(scope: Scope, values: BrandingValues) {
  const rows = await db
    .update(store)
    .set({
      primaryColor: values.primaryColor,
      accentColor: values.accentColor,
      themeRadius: values.radius,
      themeBase: values.base,
      themeTinted: values.tinted,
    })
    .where(owns(scope))
    .returning({ id: store.id });
  return rows.length === 1;
}

// The column behind each brand image; its files live in a folder named after the kind
const COLUMN = { logo: store.logoKey, logotype: store.logotypeKey } as const;
const FIELD = { logo: "logoKey", logotype: "logotypeKey" } as const;

async function currentKey(scope: Scope, kind: BrandImageKind) {
  const [row] = await db.select({ key: COLUMN[kind] }).from(store).where(owns(scope)).limit(1);
  return row ? { key: row.key } : null;
}

const dropFile = (key: string | null) =>
  key
    ? deleteObject(key).catch((error) =>
        console.error("store brand image: could not delete file", key, error),
      )
    : Promise.resolve();

/**
 * Validates (size, real type), uploads the new logo or logotype, points the store at it and
 * then deletes the previous file. The new file goes first so the store never points at a
 * missing file.
 */
export async function setStoreBrandImage(
  scope: Scope,
  kind: BrandImageKind,
  bytes: Uint8Array,
): Promise<{ ok: true } | { ok: false; error: Extract<ImageCheck, { ok: false }>["error"] | "notFound" }> {
  const check = checkImageBytes(bytes);
  if (!check.ok) return check;

  const previous = await currentKey(scope, kind);
  if (!previous) return { ok: false, error: "notFound" };

  const key = tenantKey(
    scope.tenantId,
    "stores",
    scope.storeId,
    kind,
    `${randomUUID()}.${extensionFor(check.type)}`,
  );
  await putObject({ key, body: bytes, contentType: check.type });

  try {
    const rows = await db
      .update(store)
      .set({ [FIELD[kind]]: key })
      .where(owns(scope))
      .returning({ id: store.id });
    if (rows.length !== 1) {
      await dropFile(key);
      return { ok: false, error: "notFound" };
    }
  } catch (error) {
    await dropFile(key);
    throw error;
  }

  await dropFile(previous.key);
  return { ok: true };
}

export async function removeStoreBrandImage(
  scope: Scope,
  kind: BrandImageKind,
): Promise<{ ok: true } | { ok: false; error: "notFound" }> {
  const previous = await currentKey(scope, kind);
  if (!previous) return { ok: false, error: "notFound" };
  await db.update(store).set({ [FIELD[kind]]: null }).where(owns(scope));
  await dropFile(previous.key);
  return { ok: true };
}
