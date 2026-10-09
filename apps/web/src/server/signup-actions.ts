"use server";

import { headers } from "next/headers";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { createSignupSchema } from "@/lib/validation/signup";
import { registerMerchant, type SignupMeta, type SignupResult } from "./signup";

export type SignupActionResult =
  | SignupResult
  | { ok: false; error: "invalid"; fieldErrors: Record<string, string[]> };

export async function signupAction(
  values: unknown,
  meta: SignupMeta,
  locale: string,
): Promise<SignupActionResult> {
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
  const parsed = createSignupSchema(t).safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const safeMeta: SignupMeta = {
    honeypot: typeof meta?.honeypot === "string" ? meta.honeypot : "x",
    elapsedMs: typeof meta?.elapsedMs === "number" ? meta.elapsedMs : 0,
  };
  return registerMerchant(parsed.data, safeMeta, await headers());
}
