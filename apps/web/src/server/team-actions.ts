"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import type { PermissionRequest } from "@/lib/permissions";
import { planFeatureError, type PlanFeatureError, type PlanLimitError } from "@/lib/plans";
import { createMemberRoleSchema, createMemberStoresSchema, createTeamMemberSchema, toStoreAccess } from "@/lib/validation/team";
import { addTeamMember, changeMemberRole, changeMemberStores, removeTeamMember, resetMemberPassword } from "./team";
import { getCompanyOrNull } from "./tenant";

// The company's team (Team page): team:create adds, team:update changes roles and stores and resets
// passwords, team:delete removes. The rules about who may act on whom live in team.ts.

type Failure = {
  ok: false;
  error:
    | "forbidden"
    | "invalid"
    | "notFound"
    | "self"
    | "owner"
    | "escalation"
    | "roleNotFound"
    | "storeNotFound"
    | "emailTaken"
    | "sharedAccount"
    | "failed";
  fieldErrors?: Record<string, string[]>;
};
export type TeamActionResult = { ok: true } | Failure | PlanFeatureError;
export type TeamCredentialsResult =
  | { ok: true; email: string; temporaryPassword: string }
  | Failure
  | PlanLimitError
  | PlanFeatureError;

async function actorWith(orgId: unknown, request: PermissionRequest) {
  const merchant = await getCompanyOrNull(orgId);
  if (!merchant || !merchant.can(request)) return null;
  return {
    tenantId: merchant.tenantId,
    actor: { userId: merchant.session.user.id, permissions: merchant.permissions, storeAccess: merchant.storeAccess },
    plan: merchant.subscription.plan,
    // limiting a member to some stores is a plan feature ("all stores" is always allowed)
    storeAccessFeature: merchant.hasFeature("storeAccess"),
  };
}

const validationTranslator = (locale: string) =>
  getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : routing.defaultLocale, namespace: "Validation" });

async function guard<T extends { ok: boolean }>(name: string, fn: () => Promise<T>): Promise<T | Failure> {
  try {
    return await fn();
  } catch (error) {
    console.error(`${name} failed`, error);
    return { ok: false, error: "failed" };
  }
}

export async function addTeamMemberAction(orgId: unknown, values: unknown, locale: string): Promise<TeamCredentialsResult> {
  const scope = await actorWith(orgId, { team: ["create"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = createTeamMemberSchema(await validationTranslator(locale)).safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  if (!parsed.data.access.all && !scope.storeAccessFeature) return planFeatureError("storeAccess");
  return guard("addTeamMember", () => addTeamMember(scope.tenantId, scope.actor, scope.plan, parsed.data));
}

export async function changeMemberRoleAction(orgId: unknown, memberId: unknown, values: unknown, locale: string): Promise<TeamActionResult> {
  const scope = await actorWith(orgId, { team: ["update"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(memberId);
  if (!id.success) return { ok: false, error: "notFound" };
  const parsed = createMemberRoleSchema(await validationTranslator(locale)).safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  return guard("changeMemberRole", () => changeMemberRole(scope.tenantId, scope.actor, id.data.toLowerCase(), parsed.data.roleKey));
}

export async function changeMemberStoresAction(orgId: unknown, memberId: unknown, values: unknown, locale: string): Promise<TeamActionResult> {
  const scope = await actorWith(orgId, { team: ["update"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(memberId);
  if (!id.success) return { ok: false, error: "notFound" };
  const parsed = createMemberStoresSchema(await validationTranslator(locale)).safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  const access = toStoreAccess(parsed.data.access);
  if (!access.all && !scope.storeAccessFeature) return planFeatureError("storeAccess");
  return guard("changeMemberStores", () => changeMemberStores(scope.tenantId, scope.actor, id.data.toLowerCase(), access));
}

export async function resetMemberPasswordAction(orgId: unknown, memberId: unknown): Promise<TeamCredentialsResult> {
  const scope = await actorWith(orgId, { team: ["update"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(memberId);
  if (!id.success) return { ok: false, error: "notFound" };
  return guard("resetMemberPassword", () => resetMemberPassword(scope.tenantId, scope.actor, id.data.toLowerCase()));
}

export async function removeTeamMemberAction(orgId: unknown, memberId: unknown): Promise<TeamActionResult> {
  const scope = await actorWith(orgId, { team: ["delete"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(memberId);
  if (!id.success) return { ok: false, error: "notFound" };
  return guard("removeTeamMember", () => removeTeamMember(scope.tenantId, scope.actor, id.data.toLowerCase()));
}
