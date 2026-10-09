import { randomUUID } from "node:crypto";
import { and, db, eq, store } from "@qvashop/db";
import { checkImageBytes, extensionFor, type ImageCheck } from "@/lib/images";
import type { BrandingValues } from "@/lib/validation/branding";
import { deleteObject, putObject, tenantKey } from "./storage";

// Store branding (logo + colors). Every function matches the store id AND its tenant, both
// taken from requireMerchant()/getMerchantOrNull(), never from client input.

type Scope = { tenantId: string; storeId: string };
const owns = ({ tenantId, storeId }: Scope) =>
  and(eq(store.id, storeId), eq(store.tenantId, tenantId));

/** false when the store is not in this tenant (nothing is updated). */
export async function updateBranding(scope: Scope, values: BrandingValues) {
  const rows = await db
    .update(store)
    .set({ primaryColor: values.primaryColor, accentColor: values.accentColor })
    .where(owns(scope))
    .returning({ id: store.id });
  return rows.length === 1;
}

async function currentLogoKey(scope: Scope) {
  const [row] = await db.select({ key: store.logoKey }).from(store).where(owns(scope)).limit(1);
  return row ? { key: row.key } : null;
}

const dropFile = (key: string | null) =>
  key
    ? deleteObject(key).catch((error) =>
        console.error("store logo: could not delete file", key, error),
      )
    : Promise.resolve();

/**
 * Validates (size, real type), uploads the new logo, points the store at it and then deletes
 * the previous file. The new file goes first so the store never points at a missing file.
 */
export async function setStoreLogo(
  scope: Scope,
  bytes: Uint8Array,
): Promise<{ ok: true } | { ok: false; error: Extract<ImageCheck, { ok: false }>["error"] | "notFound" }> {
  const check = checkImageBytes(bytes);
  if (!check.ok) return check;

  const previous = await currentLogoKey(scope);
  if (!previous) return { ok: false, error: "notFound" };

  const key = tenantKey(
    scope.tenantId,
    "stores",
    scope.storeId,
    "logo",
    `${randomUUID()}.${extensionFor(check.type)}`,
  );
  await putObject({ key, body: bytes, contentType: check.type });

  try {
    const rows = await db
      .update(store)
      .set({ logoKey: key })
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

export async function removeStoreLogo(scope: Scope): Promise<{ ok: true } | { ok: false; error: "notFound" }> {
  const previous = await currentLogoKey(scope);
  if (!previous) return { ok: false, error: "notFound" };
  await db.update(store).set({ logoKey: null }).where(owns(scope));
  await dropFile(previous.key);
  return { ok: true };
}
