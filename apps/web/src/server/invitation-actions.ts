"use server";

import { headers } from "next/headers";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db, eq, session as sessionTable } from "@qvashop/db";
import { routing } from "@/i18n/routing";
import { auth } from "@/lib/auth";
import { createInvitationSchema } from "@/lib/validation/team";
import { cancelInvitation, createInvitation, respondToInvitation } from "./invitations";
import { getCompanyOrNull } from "./tenant";

// Invitations for existing accounts. Creating and cancelling: team:create in the active
// company. Answering: any signed-in account, but only for an invitation to its own email.

export type InvitationActionResult =
  | { ok: true; id?: string }
  | {
      ok: false;
      error:
        | "forbidden"
        | "invalid"
        | "notFound"
        | "noAccount"
        | "alreadyMember"
        | "limit"
        | "roleNotFound"
        | "escalation"
        | "closed"
        | "failed";
      fieldErrors?: Record<string, string[]>;
    };

async function guard(name: string, fn: () => Promise<InvitationActionResult>): Promise<InvitationActionResult> {
  try {
    return await fn();
  } catch (error) {
    console.error(`${name} failed`, error);
    return { ok: false, error: "failed" };
  }
}

export async function createInvitationAction(orgId: unknown, values: unknown, locale: string): Promise<InvitationActionResult> {
  const merchant = await getCompanyOrNull(orgId);
  if (!merchant || !merchant.can({ team: ["create"] })) return { ok: false, error: "forbidden" };
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale, namespace: "Validation" });
  const parsed = createInvitationSchema(t).safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  const actor = { userId: merchant.session.user.id, permissions: merchant.permissions };
  return guard("createInvitation", () => createInvitation(merchant.tenantId, actor, parsed.data));
}

export async function cancelInvitationAction(orgId: unknown, id: unknown): Promise<InvitationActionResult> {
  const merchant = await getCompanyOrNull(orgId);
  if (!merchant || !merchant.can({ team: ["create"] })) return { ok: false, error: "forbidden" };
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "notFound" };
  return guard("cancelInvitation", async () =>
    (await cancelInvitation(merchant.tenantId, parsed.data.toLowerCase())) ? { ok: true } : { ok: false, error: "notFound" },
  );
}

/** Accepts or declines an invitation; accepting makes that company this session's active one. */
export async function respondToInvitationAction(id: unknown, accept: boolean): Promise<InvitationActionResult> {
  const current = await auth.api.getSession({ headers: await headers() });
  // Not while a temporary password is pending, and never while impersonating (a superadmin
  // must not answer invitations on someone's behalf)
  if (!current || current.user.mustChangePassword || current.session.impersonatedBy) return { ok: false, error: "forbidden" };
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: "notFound" };
  return guard("respondToInvitation", async () => {
    const result = await respondToInvitation(parsed.data.toLowerCase(), current.user, accept === true);
    if (!result.ok) return result;
    if (accept === true) {
      await db.update(sessionTable).set({ activeOrganizationId: result.tenantId }).where(eq(sessionTable.id, current.session.id));
    }
    return { ok: true };
  });
}
