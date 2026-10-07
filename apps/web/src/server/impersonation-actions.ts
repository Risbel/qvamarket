"use server";

import { headers } from "next/headers";
import { z } from "zod";
import {
  startImpersonation,
  stopImpersonation,
  type StartImpersonationResult,
  type StopImpersonationResult,
} from "./impersonation";

export async function startImpersonationAction(
  userId: unknown,
): Promise<StartImpersonationResult> {
  const parsed = z.uuid().safeParse(userId);
  if (!parsed.success) return { ok: false, error: "notFound" };
  return startImpersonation(parsed.data, await headers());
}

export async function stopImpersonationAction(): Promise<StopImpersonationResult> {
  return stopImpersonation(await headers());
}
