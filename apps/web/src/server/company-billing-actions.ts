"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import { BILLING_CYCLES } from "@/lib/billing";
import { PLAN_KEYS } from "@/lib/plans";
import { createBillingRequestSchema } from "@/lib/validation/billing";
import {
  cancelScheduledChange,
  cancelSubscription,
  changePlan,
  closeBillingRequest,
  createBillingRequest,
  reactivateSubscription,
  type BillingActor,
} from "./billing";
import { getCompanyOrNull } from "./tenant";

// The company's own Billing page (/dashboard/org/<id>/billing). Only owners (like creating
// stores: not a permission). There is no payment gateway, so an owner can only do what costs
// nothing: schedule a downgrade or a cancellation for the end of the paid period (and withdraw
// them). Anything that needs a payment or a person (a paid plan, a pause) is a request.

export type CompanyBillingResult = { ok: true } | { ok: false; error: string; fieldErrors?: Record<string, string[]> };

async function ownerOf(orgId: unknown): Promise<{ tenantId: string; actor: BillingActor } | null> {
  const company = await getCompanyOrNull(orgId);
  if (!company || !company.isOwner) return null;
  return { tenantId: company.tenantId, actor: { kind: "owner", userId: company.session.user.id } };
}

async function run(name: string, fn: () => Promise<CompanyBillingResult>): Promise<CompanyBillingResult> {
  try {
    return await fn();
  } catch (error) {
    console.error(`${name} failed`, error);
    return { ok: false, error: "failed" };
  }
}

const scheduleSchema = z.object({ planKey: z.enum(PLAN_KEYS), cycle: z.enum(BILLING_CYCLES), currencyCode: z.string().regex(/^[A-Z]{3}$/) });

/** A lower plan (or Gratis) from the end of the paid period. Refused if it would start a new period now. */
export async function scheduleDowngradeAction(orgId: unknown, values: unknown): Promise<CompanyBillingResult> {
  const owner = await ownerOf(orgId);
  if (!owner) return { ok: false, error: "forbidden" };
  const parsed = scheduleSchema.safeParse(values);
  if (!parsed.success) return { ok: false, error: "invalid" };
  return run("scheduleDowngrade", () =>
    changePlan(
      owner.tenantId,
      {
        ...parsed.data,
        timing: "periodEnd",
        startsAt: null,
        dueDays: 0,
        note: "",
        allowedOutcomes: ["atPeriodEnd", "freeAtPeriodEnd"],
      },
      owner.actor,
    ),
  );
}

export async function withdrawScheduledChangeAction(orgId: unknown): Promise<CompanyBillingResult> {
  const owner = await ownerOf(orgId);
  if (!owner) return { ok: false, error: "forbidden" };
  return run("withdrawScheduledChange", () => cancelScheduledChange(owner.tenantId, "", owner.actor));
}

export async function cancelAtPeriodEndAction(orgId: unknown): Promise<CompanyBillingResult> {
  const owner = await ownerOf(orgId);
  if (!owner) return { ok: false, error: "forbidden" };
  return run("cancelAtPeriodEnd", () => cancelSubscription(owner.tenantId, true, "", owner.actor));
}

export async function withdrawCancellationAction(orgId: unknown): Promise<CompanyBillingResult> {
  const owner = await ownerOf(orgId);
  if (!owner) return { ok: false, error: "forbidden" };
  return run("withdrawCancellation", () => reactivateSubscription(owner.tenantId, "", owner.actor));
}

/** Asks the platform for a plan change, a pause or anything else (replaces an open request). */
export async function requestBillingChangeAction(orgId: unknown, values: unknown, locale: string): Promise<CompanyBillingResult> {
  const owner = await ownerOf(orgId);
  if (!owner) return { ok: false, error: "forbidden" };
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale, namespace: "Validation" });
  const parsed = createBillingRequestSchema(t).safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  return run("requestBillingChange", () => createBillingRequest(owner.tenantId, parsed.data, owner.actor));
}

export async function withdrawRequestAction(orgId: unknown): Promise<CompanyBillingResult> {
  const owner = await ownerOf(orgId);
  if (!owner) return { ok: false, error: "forbidden" };
  return run("withdrawRequest", () => closeBillingRequest(owner.tenantId, "dismissed", owner.actor));
}
