"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { db, eq, session as sessionTable } from "@qvashop/db";
import { auth } from "@/lib/auth";
import { getMerchantContext } from "./tenant";

export type SetActiveCompanyResult = { ok: true } | { ok: false; error: "forbidden" | "notFound" };

/**
 * The company switcher: makes `tenantId` the active company of this session (the session's
 * active_organization_id, read by getMerchantContext on every request). Only a company the
 * user is a member of (and that has a store) can be chosen; other sessions are not touched.
 */
export async function setActiveCompanyAction(tenantId: unknown): Promise<SetActiveCompanyResult> {
  const current = await auth.api.getSession({ headers: await headers() });
  if (!current) return { ok: false, error: "forbidden" };
  if (current.user.mustChangePassword && !current.session.impersonatedBy) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(tenantId);
  if (!id.success) return { ok: false, error: "notFound" };
  const target = id.data.toLowerCase();
  const context = await getMerchantContext(current.user.id, target);
  if (!context || context.tenantId !== target) return { ok: false, error: "notFound" };
  await db.update(sessionTable).set({ activeOrganizationId: target }).where(eq(sessionTable.id, current.session.id));
  return { ok: true };
}
