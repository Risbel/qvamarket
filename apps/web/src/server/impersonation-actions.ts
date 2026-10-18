"use server";

import { headers } from "next/headers";
import { z } from "zod";
import {
  startImpersonation,
  stopImpersonation,
  type StartImpersonationResult,
  type StopImpersonationResult,
} from "./impersonation";

/** Impersonate `userId` inside the company `tenantId` (they must be a member of it). */
export async function startImpersonationAction(
  userId: unknown,
  tenantId: unknown,
): Promise<StartImpersonationResult> {
  const parsedUser = z.uuid().safeParse(userId);
  const parsedTenant = z.uuid().safeParse(tenantId);
  if (!parsedUser.success || !parsedTenant.success) return { ok: false, error: "notFound" };
  return startImpersonation(parsedUser.data.toLowerCase(), parsedTenant.data.toLowerCase(), await headers());
}

export async function stopImpersonationAction(): Promise<StopImpersonationResult> {
  return stopImpersonation(await headers());
}
