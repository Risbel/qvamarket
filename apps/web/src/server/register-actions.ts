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
import { addRegisterMovement, closeRegister, getClosableShift, openRegister, type RegisterResult, type RegisterViewer } from "./register";
import { getMerchantOrNull } from "./tenant";

// The store's cash register, one shift per cashier: register:create opens your shift and
// records cash in / out, register:update closes it, register:supervise closes anyone's. The
// plan's `dayClose` feature is part of `can` (permissions).

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

type Merchant = NonNullable<Awaited<ReturnType<typeof getMerchantOrNull>>>;

const viewerOf = (merchant: Merchant): RegisterViewer => ({
  userId: merchant.session.user.id,
  supervise: merchant.can({ register: ["supervise"] }),
});

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
      viewerOf(merchant),
    ),
  );
}

export async function closeRegisterAction(storeId: unknown, sessionId: unknown, values: unknown, locale: string): Promise<RegisterActionResult> {
  const merchant = await getMerchantOrNull(storeId);
  if (!merchant || !merchant.can({ register: ["update"] })) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(sessionId);
  if (!id.success) return { ok: false, error: "noSession" };
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  const viewer = viewerOf(merchant);
  // Counted in the shift's currencies (the store's, plus any other that had cash in it)
  const open = await getClosableShift(scope, id.data.toLowerCase(), viewer);
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
      open.id,
      {
        counted: toMinorPerCurrency(parsed.data.counted, currencies),
        // only a supervisor is shown the expected cash; a cashier counts blind
        shown: viewer.supervise ? (parsed.data.shown ?? null) : null,
        note: parsed.data.note,
      },
      viewer,
    ),
  );
}
