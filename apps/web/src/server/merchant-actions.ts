"use server";

import { headers } from "next/headers";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { buildStoreUrl } from "@/lib/tenancy";
import { createMerchantSchema } from "@/lib/validation/merchant";
import { createMerchant } from "./merchants";

export type CreateMerchantActionResult =
  | {
      ok: true;
      storeName: string;
      storeUrl: string;
      userEmail: string;
      temporaryPassword: string;
    }
  | {
      ok: false;
      error: "forbidden" | "failed" | "invalid" | "slugTaken" | "emailTaken";
      fieldErrors?: Record<string, string[]>;
    };

export async function createMerchantAction(
  values: unknown,
  locale: string,
): Promise<CreateMerchantActionResult> {
  // Same schema as the client form; the client is never trusted
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
  const parsed = createMerchantSchema(t).safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  const requestHeaders = await headers();
  const result = await createMerchant(parsed.data, requestHeaders);
  if (!result.ok) return { ok: false, error: result.error };

  return {
    ok: true,
    storeName: parsed.data.storeName,
    storeUrl: buildStoreUrl(parsed.data.storeSlug, requestHeaders.get("host")),
    userEmail: parsed.data.userEmail,
    temporaryPassword: parsed.data.temporaryPassword,
  };
}
