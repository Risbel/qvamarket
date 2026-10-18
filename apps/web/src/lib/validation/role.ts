import { z } from "zod";
import { normalizePermissions } from "@/lib/permissions";
import { ROLE_DESCRIPTION_MAX, ROLE_NAME_MAX } from "@/lib/roles";
import type { Translator } from "./types";

/**
 * Role form (Team > Roles). `permissions` is `{ resource: action[] }`; the server cleans it
 * with normalizePermissions (unknown entries dropped, write actions bring `read`) and checks
 * the editor is not granting more than they have.
 */
export function createRoleSchema(t: Translator) {
  return z.object({
    name: z.string().trim().min(1, t("required")).max(ROLE_NAME_MAX, t("tooLong", { max: ROLE_NAME_MAX })),
    description: z.string().trim().max(ROLE_DESCRIPTION_MAX, t("tooLong", { max: ROLE_DESCRIPTION_MAX })),
    permissions: z
      .record(z.string(), z.array(z.string()))
      .refine((value): boolean => Object.keys(normalizePermissions(value)).length > 0, t("rolePermissionsRequired")),
  });
}
export type RoleValues = z.infer<ReturnType<typeof createRoleSchema>>;
