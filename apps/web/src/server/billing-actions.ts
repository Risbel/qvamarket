"use server";

import { headers } from "next/headers";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { currencyDigits, parsePriceToMinor } from "@/lib/money";
import {
  createAdjustDateSchema,
  createBillingPaymentSchema,
  createChangePlanSchema,
  createManualInvoiceSchema,
  createNoteSchema,
  createPauseSchema,
  createPlanPriceSchema,
  createVoidInvoiceSchema,
  planPriceMinor,
} from "@/lib/validation/billing";
import { db, eq, subscriptionInvoice } from "@qvashop/db";
import { getAdminSession } from "./admin";
import {
  cancelScheduledChange,
  cancelSubscription,
  changePlan,
  closeBillingRequest,
  runBillingJob,
  issueManualInvoice,
  issueNextInvoice,
  pauseSubscription,
  reactivateSubscription,
  recordBillingPayment,
  resumeSubscription,
  setPaidUntil,
  setPlanPrice,
  setTrialEnd,
  voidInvoice,
  type BillingActor,
} from "./billing";

// Superadmin billing. Every action checks the admin session first and re-validates its input
// with the same schema as the form; ids are only used to find rows, never trusted for more.

export type BillingActionResult =
  | { ok: true }
  | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

const isUuid = (value: unknown): value is string => z.uuid().safeParse(value).success;

async function adminActor(): Promise<BillingActor | null> {
  const session = await getAdminSession(await headers());
  return session ? { kind: "admin", userId: session.user.id } : null;
}

const translator = (locale: string) =>
  getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale, namespace: "Validation" });

function invalid(error: z.ZodError): BillingActionResult {
  return { ok: false, error: "invalid", fieldErrors: z.flattenError(error).fieldErrors as Record<string, string[]> };
}

const toDate = (iso: string) => (iso ? new Date(iso) : null);

async function run(name: string, fn: () => Promise<BillingActionResult>): Promise<BillingActionResult> {
  try {
    return await fn();
  } catch (error) {
    console.error(`${name} failed`, error);
    return { ok: false, error: "failed" };
  }
}

/** Common shape: admin + a company id + a form validated with `schema`. */
async function companyAction<T>(
  name: string,
  tenantId: unknown,
  values: unknown,
  locale: string,
  schema: (t: Awaited<ReturnType<typeof translator>>) => z.ZodType<T>,
  fn: (tenantId: string, data: T, actor: BillingActor) => Promise<BillingActionResult>,
): Promise<BillingActionResult> {
  const actor = await adminActor();
  if (!actor) return { ok: false, error: "forbidden" };
  if (!isUuid(tenantId)) return { ok: false, error: "notFound" };
  const parsed = schema(await translator(locale)).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  return run(name, () => fn(tenantId.toLowerCase(), parsed.data, actor));
}

export async function changePlanAction(tenantId: unknown, values: unknown, locale: string) {
  return companyAction("changePlan", tenantId, values, locale, createChangePlanSchema, (id, data, actor) =>
    changePlan(id, { ...data, startsAt: toDate(data.startsAt) }, actor),
  );
}

export async function cancelScheduledChangeAction(tenantId: unknown, values: unknown, locale: string) {
  return companyAction("cancelScheduledChange", tenantId, values, locale, createNoteSchema, (id, data, actor) =>
    cancelScheduledChange(id, data.note, actor),
  );
}

export async function issueNextInvoiceAction(tenantId: unknown) {
  return companyAction("issueNextInvoice", tenantId, {}, routing.defaultLocale, () => z.object({}), (id, _data, actor) =>
    issueNextInvoice(id, actor),
  );
}

export async function issueManualInvoiceAction(tenantId: unknown, values: unknown, locale: string) {
  const code = z.object({ currencyCode: z.string().regex(/^[A-Z]{3}$/) }).safeParse(values);
  const digits = code.success ? currencyDigits(code.data.currencyCode) : 2;
  return companyAction(
    "issueManualInvoice",
    tenantId,
    values,
    locale,
    (t) => createManualInvoiceSchema(t, digits),
    (id, data, actor) =>
      issueManualInvoice(
        id,
        {
          amountMinor: parsePriceToMinor(data.amount, digits, Number.MAX_SAFE_INTEGER)!,
          currencyCode: data.currencyCode,
          dueAt: toDate(data.dueAt),
          note: data.note,
        },
        actor,
      ),
  );
}

export async function pauseSubscriptionAction(tenantId: unknown, values: unknown, locale: string) {
  return companyAction("pauseSubscription", tenantId, values, locale, createPauseSchema, (id, data, actor) =>
    pauseSubscription(id, toDate(data.resumesAt), data.note, actor),
  );
}

export async function resumeSubscriptionAction(tenantId: unknown, values: unknown, locale: string) {
  return companyAction("resumeSubscription", tenantId, values, locale, createNoteSchema, (id, data, actor) =>
    resumeSubscription(id, data.note, actor),
  );
}

export async function cancelSubscriptionAction(tenantId: unknown, atPeriodEnd: unknown, values: unknown, locale: string) {
  return companyAction("cancelSubscription", tenantId, values, locale, createNoteSchema, (id, data, actor) =>
    cancelSubscription(id, atPeriodEnd === true, data.note, actor),
  );
}

export async function reactivateSubscriptionAction(tenantId: unknown, values: unknown, locale: string) {
  return companyAction("reactivateSubscription", tenantId, values, locale, createNoteSchema, (id, data, actor) =>
    reactivateSubscription(id, data.note, actor),
  );
}

export async function setPaidUntilAction(tenantId: unknown, values: unknown, locale: string) {
  return companyAction("setPaidUntil", tenantId, values, locale, createAdjustDateSchema, (id, data, actor) =>
    setPaidUntil(id, new Date(data.date), data.note, actor),
  );
}

export async function setTrialEndAction(tenantId: unknown, values: unknown, locale: string) {
  return companyAction("setTrialEnd", tenantId, values, locale, createAdjustDateSchema, (id, data, actor) =>
    setTrialEnd(id, new Date(data.date), data.note, actor),
  );
}

// ---- invoices

export async function recordBillingPaymentAction(invoiceId: unknown, values: unknown, locale: string): Promise<BillingActionResult> {
  const actor = await adminActor();
  if (!actor) return { ok: false, error: "forbidden" };
  if (!isUuid(invoiceId)) return { ok: false, error: "notFound" };
  // The amount is read in the invoice's currency
  const [invoice] = await db
    .select({ currencyCode: subscriptionInvoice.currencyCode })
    .from(subscriptionInvoice)
    .where(eq(subscriptionInvoice.id, invoiceId.toLowerCase()));
  if (!invoice) return { ok: false, error: "notFound" };
  const digits = currencyDigits(invoice.currencyCode);
  const parsed = createBillingPaymentSchema(await translator(locale), digits).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  return run("recordBillingPayment", () =>
    recordBillingPayment(
      invoiceId.toLowerCase(),
      {
        kind: data.kind,
        method: data.method,
        amountMinor: parsePriceToMinor(data.amount, digits, Number.MAX_SAFE_INTEGER)!,
        reference: data.reference,
        paidAt: toDate(data.paidAt),
        note: data.note,
      },
      actor,
    ),
  );
}

export async function voidInvoiceAction(invoiceId: unknown, values: unknown, locale: string): Promise<BillingActionResult> {
  const actor = await adminActor();
  if (!actor) return { ok: false, error: "forbidden" };
  if (!isUuid(invoiceId)) return { ok: false, error: "notFound" };
  const parsed = createVoidInvoiceSchema(await translator(locale)).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  return run("voidInvoice", () => voidInvoice(invoiceId.toLowerCase(), parsed.data.reason, actor));
}

// ---- prices

export async function setPlanPriceAction(values: unknown, locale: string): Promise<BillingActionResult> {
  const actor = await adminActor();
  if (!actor) return { ok: false, error: "forbidden" };
  const parsed = createPlanPriceSchema(await translator(locale)).safeParse(values);
  if (!parsed.success) return invalid(parsed.error);
  const data = parsed.data;
  return run("setPlanPrice", () =>
    setPlanPrice(
      { planKey: data.planKey, cycle: data.cycle, currencyCode: data.currencyCode, amountMinor: planPriceMinor(data), isActive: data.isActive },
      actor,
    ),
  );
}

// ---- renewal job and owner requests

/** "Run now" in the admin: the same job as the daily schedule. */
export async function runBillingJobAction(): Promise<BillingActionResult | { ok: true; invoices: number; moves: number }> {
  const actor = await adminActor();
  if (!actor) return { ok: false, error: "forbidden" };
  try {
    const summary = await runBillingJob();
    return { ok: true, invoices: summary.invoices, moves: Object.values(summary.events).reduce((sum, n) => sum + (n ?? 0), 0) };
  } catch (error) {
    console.error("runBillingJob failed", error);
    return { ok: false, error: "failed" };
  }
}

/** Marks the company's open request as handled (`done`) or dismissed. */
export async function closeBillingRequestAction(tenantId: unknown, status: unknown): Promise<BillingActionResult> {
  const actor = await adminActor();
  if (!actor) return { ok: false, error: "forbidden" };
  if (!isUuid(tenantId) || (status !== "done" && status !== "dismissed")) return { ok: false, error: "notFound" };
  return run("closeBillingRequest", () => closeBillingRequest(tenantId.toLowerCase(), status, actor));
}
