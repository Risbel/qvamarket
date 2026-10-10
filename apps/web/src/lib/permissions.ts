import { createAccessControl } from "better-auth/plugins/access";
import {
  defaultStatements,
  ownerAc,
} from "better-auth/plugins/organization/access";

/**
 * Permissions = resource + action. This is the single place where they are defined.
 * Adding a feature: add its resource/actions here and grant them to the roles below.
 * `defaultStatements` are the organization plugin's own (organization, member, invitation).
 * Feature code checks permissions (`can`), never role names.
 */
export const statement = {
  ...defaultStatements,
  store: ["read", "update"],
  product: ["read", "create", "update", "delete"],
  category: ["read", "create", "update", "delete"],
  order: ["read", "update"],
} as const;

export const ac = createAccessControl(statement);

/** Everything, including team/company management (organization, member, invitation). */
export const owner = ac.newRole({
  ...ownerAc.statements,
  store: ["read", "update"],
  product: ["read", "create", "update", "delete"],
  category: ["read", "create", "update", "delete"],
  order: ["read", "update"],
});

/** Runs the shop: settings, catalog and orders. No team/company management. */
export const manager = ac.newRole({
  store: ["read", "update"],
  product: ["read", "create", "update", "delete"],
  category: ["read", "create", "update", "delete"],
  order: ["read", "update"],
});

/** Processes orders and can look at the catalog. No catalog edits, no settings. */
export const staff = ac.newRole({
  store: ["read"],
  product: ["read"],
  category: ["read"],
  order: ["read", "update"],
});

/** Company (tenant) roles, passed to the organization plugin. */
export const companyRoles = { owner, manager, staff };

export type CompanyRole = keyof typeof companyRoles;
export type PermissionRequest = Parameters<typeof owner.authorize>[0];

/**
 * Whether a member with this role string may do everything in `request`.
 * Better Auth stores multiple roles comma-separated ("manager,staff"): any role that
 * grants the whole request is enough. Unknown roles grant nothing.
 */
export function can(roleString: string, request: PermissionRequest): boolean {
  return roleString
    .split(",")
    .map((role) => role.trim())
    .some((role) => {
      const definition = companyRoles[role as CompanyRole];
      return definition ? definition.authorize(request).success : false;
    });
}
