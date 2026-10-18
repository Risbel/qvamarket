import { z } from "zod";
import { MAX_STORES_PER_COMPANY } from "@/lib/stores";
import type { StoreAccess } from "@/lib/store-access";
import type { Translator } from "./types";

export const MEMBER_NAME_MAX = 80;

/** A role of the company (its key); the server checks it exists and the actor may grant it. */
const roleKey = (t: Translator) => z.string().trim().min(1, t("required"));

/**
 * Which stores the member can open: all (also future ones) or at least one chosen store.
 * The server checks the ids are the company's and within the actor's own access.
 */
export function createStoreAccessSchema(t: Translator) {
  return z
    .object({ all: z.boolean(), storeIds: z.array(z.uuid()).max(MAX_STORES_PER_COMPANY) })
    .refine((v) => v.all || v.storeIds.length > 0, { path: ["storeIds"], message: t("storeAccessEmpty") });
}
export type StoreAccessValues = z.infer<ReturnType<typeof createStoreAccessSchema>>;

/** Form value -> StoreAccess (ids deduplicated, lowercase). */
export function toStoreAccess(values: StoreAccessValues): StoreAccess {
  return values.all ? { all: true } : { all: false, storeIds: [...new Set(values.storeIds.map((id) => id.toLowerCase()))] };
}

/** Team > Add member. The temporary password is generated on the server. */
export function createTeamMemberSchema(t: Translator) {
  return z.object({
    name: z.string().trim().min(2, t("required")).max(MEMBER_NAME_MAX, t("tooLong", { max: MEMBER_NAME_MAX })),
    email: z.email(t("emailInvalid")).toLowerCase(),
    roleKey: roleKey(t),
    access: createStoreAccessSchema(t),
  });
}
export type TeamMemberValues = z.infer<ReturnType<typeof createTeamMemberSchema>>;

/** Team > Change stores. */
export function createMemberStoresSchema(t: Translator) {
  return z.object({ access: createStoreAccessSchema(t) });
}

/** Team > Change role. */
export function createMemberRoleSchema(t: Translator) {
  return z.object({ roleKey: roleKey(t) });
}
export type MemberRoleValues = z.infer<ReturnType<typeof createMemberRoleSchema>>;

/** Team > Invite an existing account. */
export function createInvitationSchema(t: Translator) {
  return z.object({ email: z.email(t("emailInvalid")).toLowerCase(), roleKey: roleKey(t), access: createStoreAccessSchema(t) });
}
export type InvitationValues = z.infer<ReturnType<typeof createInvitationSchema>>;
