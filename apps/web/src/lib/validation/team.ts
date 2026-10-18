import { z } from "zod";
import type { Translator } from "./types";

export const MEMBER_NAME_MAX = 80;

/** A role of the company (its key); the server checks it exists and the actor may grant it. */
const roleKey = (t: Translator) => z.string().trim().min(1, t("required"));

/** Team > Add member. The temporary password is generated on the server. */
export function createTeamMemberSchema(t: Translator) {
  return z.object({
    name: z.string().trim().min(2, t("required")).max(MEMBER_NAME_MAX, t("tooLong", { max: MEMBER_NAME_MAX })),
    email: z.email(t("emailInvalid")).toLowerCase(),
    roleKey: roleKey(t),
  });
}
export type TeamMemberValues = z.infer<ReturnType<typeof createTeamMemberSchema>>;

/** Team > Change role. */
export function createMemberRoleSchema(t: Translator) {
  return z.object({ roleKey: roleKey(t) });
}
export type MemberRoleValues = z.infer<ReturnType<typeof createMemberRoleSchema>>;

/** Team > Invite an existing account. */
export function createInvitationSchema(t: Translator) {
  return z.object({ email: z.email(t("emailInvalid")).toLowerCase(), roleKey: roleKey(t) });
}
export type InvitationValues = z.infer<ReturnType<typeof createInvitationSchema>>;
