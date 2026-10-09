"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { MAX_IMAGE_BYTES } from "@/lib/images";
import { createBrandingSchema } from "@/lib/validation/branding";
import { removeStoreLogo, setStoreLogo, updateBranding } from "./store-branding";
import { getMerchantOrNull } from "./tenant";

export type BrandingActionResult =
  | { ok: true }
  | {
      ok: false;
      error: "forbidden" | "notFound" | "failed" | "invalid" | "empty" | "tooLarge" | "unsupportedType";
      fieldErrors?: Record<string, string[]>;
    };

// Branding is store configuration: it needs `store:update` (owner and manager).
async function authorize() {
  const merchant = await getMerchantOrNull();
  if (!merchant || !merchant.can({ store: ["update"] })) return null;
  return { tenantId: merchant.tenantId, storeId: merchant.store.id };
}

export async function updateBrandingAction(
  values: unknown,
  locale: string,
): Promise<BrandingActionResult> {
  const scope = await authorize();
  if (!scope) return { ok: false, error: "forbidden" };

  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
  const parsed = createBrandingSchema(t).safeParse(values);
  if (!parsed.success) {
    return {
      ok: false,
      error: "invalid",
      fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]>,
    };
  }

  try {
    return (await updateBranding(scope, parsed.data)) ? { ok: true } : { ok: false, error: "notFound" };
  } catch (error) {
    console.error("updateBrandingAction failed", error);
    return { ok: false, error: "failed" };
  }
}

export async function uploadLogoAction(formData: FormData): Promise<BrandingActionResult> {
  const scope = await authorize();
  if (!scope) return { ok: false, error: "forbidden" };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "empty" };
  if (file.size > MAX_IMAGE_BYTES) return { ok: false, error: "tooLarge" };

  try {
    const result = await setStoreLogo(scope, new Uint8Array(await file.arrayBuffer()));
    return result.ok ? { ok: true } : result;
  } catch (error) {
    console.error("uploadLogoAction failed", error);
    return { ok: false, error: "failed" };
  }
}

export async function removeLogoAction(): Promise<BrandingActionResult> {
  const scope = await authorize();
  if (!scope) return { ok: false, error: "forbidden" };
  try {
    return await removeStoreLogo(scope);
  } catch (error) {
    console.error("removeLogoAction failed", error);
    return { ok: false, error: "failed" };
  }
}
