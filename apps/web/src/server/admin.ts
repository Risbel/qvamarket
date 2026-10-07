import { auth } from "@/lib/auth";

/**
 * Returns the session when the caller is a superadmin (role "admin"), else null.
 * Every superadmin Server Action / route must call this first and re-check on the
 * server: hiding UI is not authorization.
 */
export async function getAdminSession(requestHeaders: Headers) {
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session || session.user.role !== "admin" || session.user.banned) {
    return null;
  }
  return session;
}
