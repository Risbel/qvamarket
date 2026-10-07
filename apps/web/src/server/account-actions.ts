"use server";

import { headers } from "next/headers";
import { APIError } from "better-auth/api";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { db, eq, user } from "@qvashop/db";
import { routing } from "@/i18n/routing";
import { auth } from "@/lib/auth";
import { createChangePasswordSchema } from "@/lib/validation/auth";

export type ChangePasswordActionResult =
  | { ok: true }
  | {
      ok: false;
      error: "unauthenticated" | "invalid" | "invalidCurrent" | "failed";
      fieldErrors?: Record<string, string[]>;
    };

export async function changePasswordAction(
  values: unknown,
  locale: string,
): Promise<ChangePasswordActionResult> {
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
  const parsed = createChangePasswordSchema(t).safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return { ok: false, error: "unauthenticated" };

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true,
      },
      headers: requestHeaders,
    });
  } catch (error) {
    if (error instanceof APIError && error.body?.code === "INVALID_PASSWORD") {
      return { ok: false, error: "invalidCurrent" };
    }
    console.error("changePassword failed", error);
    return { ok: false, error: "failed" };
  }

  // The temporary password is gone: lift the forced-change flag (server-side only)
  await db
    .update(user)
    .set({ mustChangePassword: false })
    .where(eq(user.id, session.user.id));

  return { ok: true };
}
