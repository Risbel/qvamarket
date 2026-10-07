import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { redirect } from "@/i18n/navigation";
import { auth } from "@/lib/auth";

/**
 * Returns the session when the caller is a superadmin (role "admin"), else null.
 * Every superadmin Server Action / route must call this first and re-check on the
 * server: hiding UI is not authorization.
 */
export async function getAdminSession(requestHeaders: Headers) {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (
    !session ||
    session.user.role !== "admin" ||
    session.user.banned ||
    session.user.mustChangePassword
  ) {
    return null;
  }
  return session;
}

/**
 * For superadmin pages/layouts: not signed in -> login, signed in but not admin -> 404
 * (do not reveal that the panel exists).
 */
export async function requireAdminPage(locale: string) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) redirect({ href: "/login", locale });
  if (session!.user.mustChangePassword) {
    redirect({ href: "/change-password", locale });
  }
  const admin = await getAdminSession(requestHeaders);
  if (!admin) notFound();
  return admin;
}
