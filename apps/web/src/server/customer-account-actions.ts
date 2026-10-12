"use server";

import { headers } from "next/headers";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { auth } from "@/lib/auth";
import { getStoreSlug } from "@/lib/tenancy";
import { createLoginSchema } from "@/lib/validation/auth";
import { createCustomerSignupSchema } from "@/lib/validation/customer-account";
import { registerCustomer, signInCustomer, type CustomerLoginResult, type CustomerSignupResult } from "./customer-accounts";
import { getPublicStoreBySlug } from "./public-store";
import type { SignupMeta } from "./signup";

type Invalid = { ok: false; error: "invalid"; fieldErrors: Record<string, string[]> };
type NoStore = { ok: false; error: "notFound" };
export type CustomerSignupActionResult = CustomerSignupResult | Invalid | NoStore;
export type CustomerLoginActionResult = CustomerLoginResult | Invalid | NoStore;

const validationTranslator = (locale: string) =>
  getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale, namespace: "Validation" });

/**
 * The store of the subdomain this request came to. Taken from the Host header, never from
 * the browser's input, so an account is only ever attached to the store it is used on (the
 * session cookie is set for that host too).
 */
async function currentStore(requestHeaders: Headers) {
  const slug = getStoreSlug(requestHeaders.get("host"), process.env.ROOT_DOMAIN ?? "localhost");
  return slug ? getPublicStoreBySlug(slug) : null;
}

export async function customerSignupAction(values: unknown, meta: SignupMeta, locale: string): Promise<CustomerSignupActionResult> {
  const requestHeaders = await headers();
  const store = await currentStore(requestHeaders);
  if (!store) return { ok: false, error: "notFound" };
  const parsed = createCustomerSignupSchema(await validationTranslator(locale)).safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  const safeMeta: SignupMeta = {
    honeypot: typeof meta?.honeypot === "string" ? meta.honeypot : "x",
    elapsedMs: typeof meta?.elapsedMs === "number" ? meta.elapsedMs : 0,
  };
  return registerCustomer(store.id, parsed.data, safeMeta, requestHeaders);
}

export async function customerLoginAction(values: unknown, locale: string): Promise<CustomerLoginActionResult> {
  const requestHeaders = await headers();
  const store = await currentStore(requestHeaders);
  if (!store) return { ok: false, error: "notFound" };
  const parsed = createLoginSchema(await validationTranslator(locale)).safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  return signInCustomer(store.id, parsed.data, requestHeaders);
}

/** Ends the session of this host (other stores' sessions are separate cookies). */
export async function customerSignOutAction(): Promise<{ ok: true }> {
  try {
    await auth.api.signOut({ headers: await headers() });
  } catch {
    // no session: already signed out
  }
  return { ok: true };
}
