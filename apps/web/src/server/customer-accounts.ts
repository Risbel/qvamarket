import { isAPIError } from "better-auth/api";
import { and, customer, db, desc, eq, order, sql, store, user } from "@qvashop/db";
import { auth } from "@/lib/auth";
import type { LoginValues } from "@/lib/validation/auth";
import type { CustomerSignupValues } from "@/lib/validation/customer-account";
import { createRateLimiter } from "./rate-limit";
import { clientIp } from "./request";
import { MIN_FILL_MS, type SignupMeta } from "./signup";

// Customer accounts on a store's subdomain. One global Better Auth account per person; a
// `customer` record per company, created the first time they sign up or sign in on one of
// its stores. Like checkout.ts this runs for visitors of a public store: the store is an
// active one, and tenant_id is read from its row here and never leaves this file. The
// session cookie is host-only, so it belongs to this store's subdomain alone.

// Per client IP (and per email for sign-in, so one account cannot be guessed at from many
// addresses). Server-side calls skip Better Auth's own rate limiter, hence these.
const signupAttempts = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });
const signupAccounts = createRateLimiter({ limit: 5, windowMs: 24 * 60 * 60 * 1000 });
const loginByIp = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });
const loginByEmail = createRateLimiter({ limit: 10, windowMs: 10 * 60 * 1000 });

export type CustomerSignupResult =
  | { ok: true }
  | { ok: false; error: "emailTaken" | "tooManyAttempts" | "rejected" | "failed" };

export type CustomerLoginResult =
  | { ok: true }
  | { ok: false; error: "invalidCredentials" | "tooManyAttempts" | "failed" };

/**
 * The company's customer record for this account, created if missing (an existing record
 * is never overwritten: the person may have edited it). Returns it (id and the contact
 * details checkout prefills), or null when the store is not active.
 */
export async function ensureCustomer(storeId: string, account: { id: string; name: string; email: string }) {
  const [owner] = await db
    .select({ tenantId: store.tenantId })
    .from(store)
    .where(and(eq(store.id, storeId), eq(store.status, "active")))
    .limit(1);
  if (!owner) return null;
  const [row] = await db
    .insert(customer)
    .values({ tenantId: owner.tenantId, userId: account.id, name: account.name.trim() || account.email, email: account.email })
    .onConflictDoUpdate({
      target: [customer.tenantId, customer.userId],
      targetWhere: sql`${customer.userId} is not null`,
      // no change; only makes RETURNING give back the existing row
      set: { updatedAt: sql`${customer.updatedAt}` },
    })
    .returning({ id: customer.id, name: customer.name, phone: customer.phone, email: customer.email });
  return row;
}

export const ACCOUNT_ORDERS_LIMIT = 50;

/**
 * The orders this account placed on this store while signed in (newest first). Guest orders
 * are not included even when their phone matches: typing a phone proves nothing.
 */
export async function listAccountOrders(storeId: string, userId: string) {
  return db
    .select({
      id: order.id,
      number: order.number,
      createdAt: order.createdAt,
      status: order.status,
      currencyCode: order.currencyCode,
      totalMinor: order.totalMinor,
    })
    .from(order)
    .where(and(eq(order.storeId, storeId), eq(order.userId, userId)))
    .orderBy(desc(order.createdAt))
    .limit(ACCOUNT_ORDERS_LIMIT);
}

/**
 * Creates the account (signed in right away: the cookie is set for this host) and the
 * company's customer record. `values` must already be validated. Email is not verified (no
 * email provider yet): the defenses are the per-IP limits, a honeypot and a minimum fill
 * time, like merchant signup.
 */
export async function registerCustomer(
  storeId: string,
  values: CustomerSignupValues,
  meta: SignupMeta,
  requestHeaders: Headers,
): Promise<CustomerSignupResult> {
  const ip = clientIp(requestHeaders);
  if (!signupAttempts.tryConsume(ip) || signupAccounts.isFull(ip)) return { ok: false, error: "tooManyAttempts" };
  if (meta.honeypot !== "" || !(meta.elapsedMs >= MIN_FILL_MS)) return { ok: false, error: "rejected" };

  const [taken] = await db.select({ id: user.id }).from(user).where(eq(user.email, values.email)).limit(1);
  if (taken) return { ok: false, error: "emailTaken" };

  try {
    const created = await auth.api.signUpEmail({
      body: { email: values.email, password: values.password, name: values.name },
      headers: requestHeaders,
    });
    signupAccounts.record(ip);
    await ensureCustomer(storeId, created.user);
    return { ok: true };
  } catch (error) {
    if (isAPIError(error) && error.body?.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL") {
      return { ok: false, error: "emailTaken" };
    }
    console.error("registerCustomer failed", error);
    return { ok: false, error: "failed" };
  }
}

/** Signs in on this store's host and makes sure the company knows the customer. */
export async function signInCustomer(storeId: string, values: LoginValues, requestHeaders: Headers): Promise<CustomerLoginResult> {
  const email = values.email.trim().toLowerCase();
  if (!loginByIp.tryConsume(clientIp(requestHeaders)) || !loginByEmail.tryConsume(email)) {
    return { ok: false, error: "tooManyAttempts" };
  }
  let account: { id: string; name: string; email: string };
  try {
    ({ user: account } = await auth.api.signInEmail({ body: { email, password: values.password }, headers: requestHeaders }));
  } catch (error) {
    // Wrong password, unknown email and banned accounts all look the same
    if (isAPIError(error)) return { ok: false, error: "invalidCredentials" };
    console.error("signInCustomer failed", error);
    return { ok: false, error: "failed" };
  }
  try {
    await ensureCustomer(storeId, account);
  } catch (error) {
    // The session is valid; the record is created again on the next visit to the account page
    console.error("ensureCustomer failed", error);
  }
  return { ok: true };
}
