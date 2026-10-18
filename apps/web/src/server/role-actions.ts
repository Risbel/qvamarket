"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import type { PermissionRequest } from "@/lib/permissions";
import { createRoleSchema } from "@/lib/validation/role";
import { createCompanyRole, deleteCompanyRole, updateCompanyRole } from "./company-roles";
import { getMerchantOrNull } from "./tenant";

// Company roles (Team > Roles): role:create / role:update / role:delete. The editor's own
// permissions go to the server functions, which refuse granting more than that.

export type RoleActionResult =
  | { ok: true; id?: string }
  | {
      ok: false;
      error: "forbidden" | "notFound" | "invalid" | "nameTaken" | "limit" | "escalation" | "empty" | "inUse" | "failed";
      fieldErrors?: Record<string, string[]>;
      memberCount?: number;
    };

async function merchantWith(request: PermissionRequest) {
  const merchant = await getMerchantOrNull();
  return merchant && merchant.can(request) ? merchant : null;
}

async function parse(values: unknown, locale: string) {
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
  return createRoleSchema(t).safeParse(values);
}

async function guard(fn: () => Promise<RoleActionResult>): Promise<RoleActionResult> {
  try {
    return await fn();
  } catch (error) {
    console.error("role action failed", error);
    return { ok: false, error: "failed" };
  }
}

export async function createRoleAction(values: unknown, locale: string): Promise<RoleActionResult> {
  const merchant = await merchantWith({ role: ["create"] });
  if (!merchant) return { ok: false, error: "forbidden" };
  const parsed = await parse(values, locale);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  return guard(() => createCompanyRole(merchant.tenantId, merchant.permissions, parsed.data));
}

export async function updateRoleAction(id: unknown, values: unknown, locale: string): Promise<RoleActionResult> {
  const merchant = await merchantWith({ role: ["update"] });
  if (!merchant) return { ok: false, error: "forbidden" };
  const roleId = z.uuid().safeParse(id);
  if (!roleId.success) return { ok: false, error: "notFound" };
  const parsed = await parse(values, locale);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  return guard(() => updateCompanyRole(merchant.tenantId, merchant.permissions, roleId.data.toLowerCase(), parsed.data));
}

export async function deleteRoleAction(id: unknown): Promise<RoleActionResult> {
  const merchant = await merchantWith({ role: ["delete"] });
  if (!merchant) return { ok: false, error: "forbidden" };
  const roleId = z.uuid().safeParse(id);
  if (!roleId.success) return { ok: false, error: "notFound" };
  return guard(() => deleteCompanyRole(merchant.tenantId, merchant.permissions, roleId.data.toLowerCase()));
}
