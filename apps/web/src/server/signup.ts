import { auth } from "@/lib/auth";
import type { SignupValues } from "@/lib/validation/signup";
import {
  createCompanyAndStore,
  findUnavailable,
  removeUser,
} from "./provisioning";
import { createRateLimiter } from "./rate-limit";
import { clientIp } from "./request";

// Per client IP. Tune with env vars; the defaults suit a small platform.
const attempts = createRateLimiter({
  limit: Number(process.env.SIGNUP_MAX_ATTEMPTS ?? 10),
  windowMs: 60 * 60 * 1000, // attempts per hour
});
const accounts = createRateLimiter({
  limit: Number(process.env.SIGNUP_MAX_ACCOUNTS ?? 3),
  windowMs: 24 * 60 * 60 * 1000, // accounts created per day
});

/** A real person needs a moment to fill 7 fields; autofill + click still takes longer. */
export const MIN_FILL_MS = 1500;

export type SignupMeta = {
  /** value of the hidden "website" field: humans never see it, bots fill it */
  honeypot: string;
  /** milliseconds between the form appearing and the submit (client-reported) */
  elapsedMs: number;
};

export type SignupResult =
  | { ok: true }
  | { ok: false; error: "slugTaken" | "emailTaken" | "tooManyAttempts" | "rejected" | "failed" };

/**
 * A merchant registers themselves: user (own password) + company + first store, which
 * starts PENDING: it is not public until the superadmin approves it. The user is signed in
 * (Better Auth's sign-up sets the session cookie) so they can start setting things up.
 * `input` must already be validated with createSignupSchema.
 *
 * Email is not verified (no email provider yet), so the defenses are: per-IP limits, a
 * honeypot, a minimum fill time, and the manual approval. Add a captcha (Cloudflare
 * Turnstile) before opening signup to the public.
 */
export async function registerMerchant(
  input: SignupValues,
  meta: SignupMeta,
  requestHeaders: Headers,
): Promise<SignupResult> {
  const ip = clientIp(requestHeaders);
  if (!attempts.tryConsume(ip) || accounts.isFull(ip)) {
    return { ok: false, error: "tooManyAttempts" };
  }

  // The client-reported time is only a speed bump for naive bots
  if (meta.honeypot !== "" || !(meta.elapsedMs >= MIN_FILL_MS)) {
    return { ok: false, error: "rejected" };
  }

  const unavailable = await findUnavailable(input);
  if (unavailable) return { ok: false, error: unavailable };

  let userId: string | undefined;
  try {
    const created = await auth.api.signUpEmail({
      body: { email: input.userEmail, password: input.password, name: input.userName },
      headers: requestHeaders,
    });
    userId = created.user.id;

    await createCompanyAndStore(userId, input, "pending");
    accounts.record(ip);
    return { ok: true };
  } catch (error) {
    console.error("registerMerchant failed", error);
    if (userId) await removeUser(userId);
    return { ok: false, error: "failed" };
  }
}
