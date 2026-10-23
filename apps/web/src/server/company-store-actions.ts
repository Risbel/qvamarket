"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import type { PlanLimitError } from "@/lib/plans";
import { createNewStoreSchema } from "@/lib/validation/store";
import { createCompanyStore } from "./company-stores";
import { getCompanyOrNull } from "./tenant";

export type CreateStoreActionResult =
  | PlanLimitError
  | { ok: true; storeId: string }
  | {
      ok: false;
      error: "forbidden" | "invalid" | "slugTaken" | "limit" | "failed";
      fieldErrors?: Record<string, string[]>;
    };

/** Company panel > Stores > Create store. Owners only (decided 2026-10: not a permission). */
export async function createStoreAction(orgId: unknown, values: unknown, locale: string): Promise<CreateStoreActionResult> {
  const company = await getCompanyOrNull(orgId);
  if (!company || !company.isOwner) return { ok: false, error: "forbidden" };
  const t = await getTranslations({
    locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale,
    namespace: "Validation",
  });
  const parsed = createNewStoreSchema(t).safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  try {
    return await createCompanyStore(company.tenantId, company.subscription.plan, parsed.data);
  } catch (error) {
    console.error("createStoreAction failed", error);
    return { ok: false, error: "failed" };
  }
}
