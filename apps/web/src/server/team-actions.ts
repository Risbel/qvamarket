"use server";

import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { routing } from "@/i18n/routing";
import type { PermissionRequest } from "@/lib/permissions";
import { createMemberRoleSchema, createTeamMemberSchema } from "@/lib/validation/team";
import { addTeamMember, changeMemberRole, removeTeamMember, resetMemberPassword } from "./team";
import { getMerchantOrNull } from "./tenant";

// The company's team (Team page): team:create adds, team:update changes roles and resets
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
    | "emailTaken"
    | "sharedAccount"
    | "failed";
  fieldErrors?: Record<string, string[]>;
};
export type TeamActionResult = { ok: true } | Failure;
export type TeamCredentialsResult = { ok: true; email: string; temporaryPassword: string } | Failure;

async function actorWith(request: PermissionRequest) {
  const merchant = await getMerchantOrNull();
  if (!merchant || !merchant.can(request)) return null;
  return {
    tenantId: merchant.tenantId,
    actor: { userId: merchant.session.user.id, permissions: merchant.permissions },
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

export async function addTeamMemberAction(values: unknown, locale: string): Promise<TeamCredentialsResult> {
  const scope = await actorWith({ team: ["create"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const parsed = createTeamMemberSchema(await validationTranslator(locale)).safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  return guard("addTeamMember", () => addTeamMember(scope.tenantId, scope.actor, parsed.data));
}

export async function changeMemberRoleAction(memberId: unknown, values: unknown, locale: string): Promise<TeamActionResult> {
  const scope = await actorWith({ team: ["update"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(memberId);
  if (!id.success) return { ok: false, error: "notFound" };
  const parsed = createMemberRoleSchema(await validationTranslator(locale)).safeParse(values);
  if (!parsed.success) {
    return { ok: false, error: "invalid", fieldErrors: z.flattenError(parsed.error).fieldErrors as Record<string, string[]> };
  }
  return guard("changeMemberRole", () => changeMemberRole(scope.tenantId, scope.actor, id.data.toLowerCase(), parsed.data.roleKey));
}

export async function resetMemberPasswordAction(memberId: unknown): Promise<TeamCredentialsResult> {
  const scope = await actorWith({ team: ["update"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(memberId);
  if (!id.success) return { ok: false, error: "notFound" };
  return guard("resetMemberPassword", () => resetMemberPassword(scope.tenantId, scope.actor, id.data.toLowerCase()));
}

export async function removeTeamMemberAction(memberId: unknown): Promise<TeamActionResult> {
  const scope = await actorWith({ team: ["delete"] });
  if (!scope) return { ok: false, error: "forbidden" };
  const id = z.uuid().safeParse(memberId);
  if (!id.success) return { ok: false, error: "notFound" };
  return guard("removeTeamMember", () => removeTeamMember(scope.tenantId, scope.actor, id.data.toLowerCase()));
}
