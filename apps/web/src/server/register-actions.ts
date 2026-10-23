"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { currencyDigits, parsePriceToMinor } from "@/lib/money";
import {
  createCloseRegisterSchema,
  createMovementSchema,
  createOpenRegisterSchema,
  toMinorPerCurrency,
} from "@/lib/validation/register";
import { addRegisterMovement, closeRegister, getOpenRegister, openRegister, type RegisterResult } from "./register";
import { getMerchantOrNull } from "./tenant";

// The store's cash register: register:create opens it and records cash in / out,
// register:update closes it. The plan's `dayClose` feature is part of `can` (permissions).

export type RegisterActionResult =
  | RegisterResult
  | { ok: false; error: "forbidden" | "invalid" | "failed"; fieldErrors?: Record<string, string[]> };

const translator = (locale: string) =>
  getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale, namespace: "Validation" });

/** Nested fields keyed by their full path ("floats.USD"), so the form marks the right input. */
function invalid(error: z.ZodError): RegisterActionResult {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) (fieldErrors[issue.path.join(".")] ??= []).push(issue.message);
  return { ok: false, error: "invalid", fieldErrors };
}

async function guard(name: string, fn: () => Promise<RegisterActionResult>): Promise<RegisterActionResult> {
  try {
    return await fn();
  } catch (error) {
    console.error(`${name} failed`, error);
    return { ok: false, error: "failed" };
  }
}

export async function openRegisterAction(storeId: unknown, values: unknown, locale: string): Promise<RegisterActionResult> {
  const merchant = await getMerchantOrNull(storeId);
  if (!merchant || !merchant.can({ register: ["create"] })) return { ok: false, error: "forbidden" };
  const currencies = merchant.store.currencies;
  const parsed = createOpenRegisterSchema(await translator(locale), currencies).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  return guard("openRegister", () =>
    openRegister(
      scope,
      { floats: toMinorPerCurrency(parsed.data.floats, currencies), note: parsed.data.note },
      currencies.map((c) => c.code),
      merchant.session.user.id,
    ),
  );
}

export async function addRegisterMovementAction(storeId: unknown, values: unknown, locale: string): Promise<RegisterActionResult> {
  const merchant = await getMerchantOrNull(storeId);
  if (!merchant || !merchant.can({ register: ["create"] })) return { ok: false, error: "forbidden" };
  const currencies = merchant.store.currencies;
  const parsed = createMovementSchema(await translator(locale), currencies).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const { kind, currencyCode, amount, note } = parsed.data;
  const digits = currencies.find((c) => c.code === currencyCode)?.digits ?? currencyDigits(currencyCode);
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  return guard("addRegisterMovement", () =>
    addRegisterMovement(
      scope,
      { kind, currencyCode, amountMinor: parsePriceToMinor(amount, digits, Number.MAX_SAFE_INTEGER)!, note },
      currencies.map((c) => c.code),
      merchant.session.user.id,
    ),
  );
}

export async function closeRegisterAction(storeId: unknown, values: unknown, locale: string): Promise<RegisterActionResult> {
  const merchant = await getMerchantOrNull(storeId);
  if (!merchant || !merchant.can({ register: ["update"] })) return { ok: false, error: "forbidden" };
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  // Counted in the session's currencies (the store's, plus any other that had cash in it)
  const open = await getOpenRegister(scope);
  if (!open) return { ok: false, error: "noSession" };
  const currencies = open.drawers.map((d) => ({
    code: d.currency,
    digits: merchant.store.currencies.find((c) => c.code === d.currency)?.digits ?? currencyDigits(d.currency),
  }));
  const parsed = createCloseRegisterSchema(await translator(locale), currencies).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  return guard("closeRegister", () =>
    closeRegister(
      scope,
      { counted: toMinorPerCurrency(parsed.data.counted, currencies), shown: parsed.data.shown, note: parsed.data.note },
      merchant.session.user.id,
    ),
  );
}
