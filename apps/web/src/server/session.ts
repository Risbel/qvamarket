import { headers } from "next/headers";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";

/**
 * For any page that needs a signed-in user (merchant or admin).
 * - not signed in -> login
 * - temporary password still in use -> forced change-password page
 * Use this (or requireAdminPage) in every protected layout/page so the forced
 * password change cannot be skipped by typing another URL.
 */
export async function requireUser(locale: string) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect({ href: "/login", locale });
  // A superadmin impersonating a merchant must not be forced to change the merchant's password
  if (session!.user.mustChangePassword && !session!.session.impersonatedBy) {
    redirect({ href: "/change-password", locale });
  }
  return session!;
}
