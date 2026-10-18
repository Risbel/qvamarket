import { randomUUID } from "node:crypto";
import { getTranslations } from "next-intl/server";
import { and, asc, companyRole, count, db, eq, inArray, member, organization, sql } from "@qvashop/db";
import {
  OWNER_PERMISSIONS,
  OWNER_ROLE,
  ROLE_PRESET_KEYS,
  hasPermissions,
  isOwner,
  mergePermissions,
  normalizePermissions,
  presetPermissions,
  roleKeys,
  type Permissions,
} from "@/lib/permissions";
import { MAX_COMPANY_ROLES } from "@/lib/roles";
import type { RoleValues } from "@/lib/validation/role";
import { routing } from "@/i18n/routing";

// Company roles (company_role). Every function takes the tenantId from requireMerchant() /
// getMerchantOrNull(). Writes lock the company's organization row, so the roles limit, the
// "in use" check and member role changes (team page) are serialized per company.

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Seeds the preset roles (ROLE_PRESETS, named in `locale`) into a company that has no roles
 * yet: every new company, and companies created before roles existed (the roles page calls
 * it). A company that already has roles is left alone, so a preset it deleted stays deleted.
 * Concurrent calls are harmless (conflicts are ignored).
 */
export async function ensureCompanyRoles(tenantId: string, locale: string = routing.defaultLocale) {
  const [{ total }] = await db.select({ total: count() }).from(companyRole).where(eq(companyRole.tenantId, tenantId));
  if (total > 0) return;
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
export async function memberPermissions(
  tenantId: string,
  roleString: string,
  executor: typeof db | Tx = db,
): Promise<Permissions> {
  if (isOwner(roleString)) return OWNER_PERMISSIONS;
  const keys = roleKeys(roleString);
  if (keys.length === 0) return {};
  const rows = await executor
    .select({ permissions: companyRole.permissions })
    .from(companyRole)
    .where(and(eq(companyRole.tenantId, tenantId), inArray(companyRole.key, keys)));
  return mergePermissions(rows.map((row) => normalizePermissions(row.permissions)));
}

/** member.role holds comma-separated keys: does it contain this key? (SQL, for joins) */
const holdsKey = (key: unknown) => sql`${key} = any(string_to_array(replace(${member.role}, ' ', ''), ','))`;

export type CompanyRoleRow = {
  id: string;
  key: string;
  name: string;
  description: string | null;
  presetKey: string | null;
  permissions: Permissions;
  memberCount: number;
};

/** The company's roles with how many members hold each, by name. */
export async function listCompanyRoles(tenantId: string): Promise<CompanyRoleRow[]> {
  const rows = await db
    .select({
      id: companyRole.id,
      key: companyRole.key,
      name: companyRole.name,
      description: companyRole.description,
      presetKey: companyRole.presetKey,
      permissions: companyRole.permissions,
      memberCount: count(member.id),
    })
    .from(companyRole)
    .leftJoin(member, and(eq(member.organizationId, companyRole.tenantId), holdsKey(companyRole.key)))
    .where(eq(companyRole.tenantId, tenantId))
    .groupBy(companyRole.id)
    .orderBy(asc(sql`lower(${companyRole.name})`));
  return rows.map((row) => ({ ...row, permissions: normalizePermissions(row.permissions) }));
}

/** How many members of the company are owners (the built-in role shown first in the list). */
export async function countOwners(tenantId: string): Promise<number> {
  const [{ total }] = await db
    .select({ total: count() })
    .from(member)
    .where(and(eq(member.organizationId, tenantId), holdsKey(OWNER_ROLE)));
  return total;
}

export async function getCompanyRole(tenantId: string, id: string) {
  const [row] = await db
    .select({
      id: companyRole.id,
      key: companyRole.key,
      name: companyRole.name,
      description: companyRole.description,
      presetKey: companyRole.presetKey,
      permissions: companyRole.permissions,
    })
    .from(companyRole)
    .where(and(eq(companyRole.tenantId, tenantId), eq(companyRole.id, id)));
  return row ? { ...row, permissions: normalizePermissions(row.permissions) } : null;
}

export type SaveRoleResult =
  | { ok: true; id: string }
  | { ok: false; error: "notFound" | "nameTaken" | "limit" | "escalation" | "empty" };
export type DeleteRoleResult =
  | { ok: true }
  | { ok: false; error: "notFound" | "escalation" | "inUse"; memberCount?: number };

function nameTaken(error: unknown) {
  const e = error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  const inner = e?.cause ?? e;
  return inner?.code === "23505" && inner?.constraint === "company_role_tenant_name_unique";
}

/** Serializes a company's role and membership writes (see the note at the top). */
export async function lockCompany(tx: Tx, tenantId: string) {
  await tx.select({ id: organization.id }).from(organization).where(eq(organization.id, tenantId)).for("no key update");
}

function toRow(values: RoleValues) {
  return {
    name: values.name,
    description: values.description === "" ? null : values.description,
    permissions: normalizePermissions(values.permissions),
  };
}

/**
 * Creates a custom role (key `r-<random>`). `editor` = the permissions of who is saving it:
 * a role can never grant more than its editor has (no escalation).
 */
export async function createCompanyRole(tenantId: string, editor: Permissions, values: RoleValues): Promise<SaveRoleResult> {
  const row = toRow(values);
  if (Object.keys(row.permissions).length === 0) return { ok: false, error: "empty" };
  if (!hasPermissions(editor, row.permissions)) return { ok: false, error: "escalation" };
  try {
    return await db.transaction(async (tx) => {
      await lockCompany(tx, tenantId);
      const [{ total }] = await tx.select({ total: count() }).from(companyRole).where(eq(companyRole.tenantId, tenantId));
      if (total >= MAX_COMPANY_ROLES) return { ok: false, error: "limit" } as const;
      const key = `r-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
      const [created] = await tx
        .insert(companyRole)
        .values({ tenantId, key, ...row })
        .returning({ id: companyRole.id });
      return { ok: true, id: created.id } as const;
    });
  } catch (error) {
    if (nameTaken(error)) return { ok: false, error: "nameTaken" };
    throw error;
  }
}

/**
 * Renames / re-describes a role and replaces its permissions. The editor must already have
 * everything the role grants now (nobody edits a role above their own) and everything it
 * will grant. Members holding the role get the new permissions on their next request.
 */
export async function updateCompanyRole(
  tenantId: string,
  editor: Permissions,
  id: string,
  values: RoleValues,
): Promise<SaveRoleResult> {
  const row = toRow(values);
  if (Object.keys(row.permissions).length === 0) return { ok: false, error: "empty" };
  try {
    return await db.transaction(async (tx) => {
      await lockCompany(tx, tenantId);
      const [current] = await tx
        .select({ permissions: companyRole.permissions })
        .from(companyRole)
        .where(and(eq(companyRole.tenantId, tenantId), eq(companyRole.id, id)));
      if (!current) return { ok: false, error: "notFound" } as const;
      if (!hasPermissions(editor, normalizePermissions(current.permissions)) || !hasPermissions(editor, row.permissions)) {
        return { ok: false, error: "escalation" } as const;
      }
      await tx
        .update(companyRole)
        .set(row)
        .where(and(eq(companyRole.tenantId, tenantId), eq(companyRole.id, id)));
      return { ok: true, id } as const;
    });
  } catch (error) {
    if (nameTaken(error)) return { ok: false, error: "nameTaken" };
    throw error;
  }
}

/** Deletes a role nobody holds (otherwise `inUse` with the count: change their role first). */
export async function deleteCompanyRole(tenantId: string, editor: Permissions, id: string): Promise<DeleteRoleResult> {
  return db.transaction(async (tx) => {
    await lockCompany(tx, tenantId);
    const [current] = await tx
      .select({ key: companyRole.key, permissions: companyRole.permissions })
      .from(companyRole)
      .where(and(eq(companyRole.tenantId, tenantId), eq(companyRole.id, id)));
    if (!current) return { ok: false, error: "notFound" } as const;
    if (!hasPermissions(editor, normalizePermissions(current.permissions))) return { ok: false, error: "escalation" } as const;
    const [{ total }] = await tx
      .select({ total: count() })
      .from(member)
      .where(and(eq(member.organizationId, tenantId), holdsKey(current.key)));
    if (total > 0) return { ok: false, error: "inUse", memberCount: total } as const;
    await tx.delete(companyRole).where(and(eq(companyRole.tenantId, tenantId), eq(companyRole.id, id)));
    return { ok: true } as const;
  });
}
