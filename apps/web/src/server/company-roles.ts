import { getTranslations } from "next-intl/server";
import { and, companyRole, db, eq, inArray } from "@qvashop/db";
import {
  OWNER_PERMISSIONS,
  ROLE_PRESET_KEYS,
  isOwner,
  mergePermissions,
  normalizePermissions,
  presetPermissions,
  roleKeys,
  type Permissions,
} from "@/lib/permissions";
import { routing } from "@/i18n/routing";

/**
 * Creates the preset roles (ROLE_PRESETS) a company does not have yet, named in `locale`.
 * Idempotent: a preset key that exists (even renamed or edited) is left alone, and a name
 * already taken by another role skips that preset. Called when a company is created and
 * when the roles page opens (companies created before roles existed get them then).
 */
export async function ensureCompanyRoles(tenantId: string, locale: string = routing.defaultLocale) {
  const t = await getTranslations({ locale, namespace: "Roles.presets" });
  await db
    .insert(companyRole)
    .values(
      ROLE_PRESET_KEYS.map((key) => ({
        tenantId,
        key,
        presetKey: key,
        name: t(`${key}.name`),
        description: t(`${key}.description`),
        permissions: presetPermissions(key),
      })),
    )
    .onConflictDoNothing();
}

/**
 * What a `member.role` string grants in a company: everything for `owner`, otherwise the
 * union of the company's roles with those keys. Unknown or deleted keys grant nothing.
 * The permissions are re-checked on read (normalizePermissions), the DB only knows the
 * column is an object.
 */
export async function memberPermissions(tenantId: string, roleString: string): Promise<Permissions> {
  if (isOwner(roleString)) return OWNER_PERMISSIONS;
  const keys = roleKeys(roleString);
  if (keys.length === 0) return {};
  const rows = await db
    .select({ permissions: companyRole.permissions })
    .from(companyRole)
    .where(and(eq(companyRole.tenantId, tenantId), inArray(companyRole.key, keys)));
  return mergePermissions(rows.map((row) => normalizePermissions(row.permissions)));
}
