"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { findPhoneCountry } from "@/lib/countries";
import { parsePriceToMinor } from "@/lib/money";
import { normalizePhone } from "@/lib/phone";
import { createPosSaleSchema } from "@/lib/validation/pos";
import { placePosSale, type PosSaleResult } from "./pos";
import { getMerchantOrNull } from "./tenant";

// Counter sales: `pos:create`. On a plan with day close the seller needs an open register
// shift (their cash goes to their drawer); without it, sales simply have no shift.

export type PosActionResult = PosSaleResult | { ok: false; error: "forbidden" | "invalid" | "failed" };

export async function placePosSaleAction(storeId: unknown, values: unknown, locale: string): Promise<PosActionResult> {
  const merchant = await getMerchantOrNull(storeId);
  if (!merchant || !merchant.can({ pos: ["create"] })) return { ok: false, error: "forbidden" };
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale, namespace: "Validation" });
  const currencies = merchant.store.currencies;
  const parsed = createPosSaleSchema(t, currencies).safeParse(values);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const sale = parsed.data;
  const digits = currencies.find((c) => c.code === sale.currencyCode)!.digits;

  try {
    return await placePosSale(
      { tenantId: merchant.tenantId, storeId: merchant.store.id },
      {
        currencyCode: sale.currencyCode,
        items: sale.items,
        expectedTotalMinor: sale.expectedTotalMinor,
        idempotencyKey: sale.idempotencyKey.toLowerCase(),
        payments: sale.payments.map((p) => ({
          method: p.method,
          amountMinor: parsePriceToMinor(p.amount, digits, Number.MAX_SAFE_INTEGER)!,
          reference: p.reference || null,
        })),
        payLater: sale.payLater,
        customer: {
          name: sale.customerName,
          phone: sale.customerPhone ? normalizePhone(sale.customerPhone, findPhoneCountry(sale.phoneCountry)) : null,
        },
        note: sale.note || null,
      },
      {
        userId: merchant.session.user.id,
        // the shift is required only where the register exists (plan with day close)
        requireShift: merchant.hasFeature("dayClose"),
      },
    );
  } catch (error) {
    console.error("placePosSale failed", error);
    return { ok: false, error: "failed" };
  }
}
