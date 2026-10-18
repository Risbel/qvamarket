"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { db, eq, session as sessionTable } from "@qvashop/db";
import { auth } from "@/lib/auth";
import { getCompanyContext } from "./tenant";

export type SetActiveCompanyResult = { ok: true } | { ok: false; error: "forbidden" | "notFound" };

/**
 * The company switcher: remembers `tenantId` as this session's company (the session's
 * active_organization_id), which /dashboard opens. The panel itself reads the company from
 * the URL. Only a company the user is a member of; other sessions are not touched.
 */
export async function setActiveCompanyAction(tenantId: unknown): Promise<SetActiveCompanyResult> {
  const current = await auth.api.getSession({ headers: await headers() });
  if (!current) return { ok: false, error: "forbidden" };
  if (current.user.mustChangePassword && !current.session.impersonatedBy) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(tenantId);
  if (!id.success) return { ok: false, error: "notFound" };
  const context = await getCompanyContext(current.user.id, id.data);
  if (!context) return { ok: false, error: "notFound" };
  await db.update(sessionTable).set({ activeOrganizationId: context.tenantId }).where(eq(sessionTable.id, current.session.id));
  return { ok: true };
}
