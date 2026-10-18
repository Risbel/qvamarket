import { RESOURCES, statement, type Permissions, type Resource } from "./permissions";

/** Company roles (Team > Roles). Limits shared by the form and the server. */
export const MAX_COMPANY_ROLES = 20;
export const ROLE_NAME_MAX = 40;
export const ROLE_DESCRIPTION_MAX = 200;

/** The resources a role grants something on, in statement order (for summaries). */
export function grantedResources(permissions: Permissions): Resource[] {
  return RESOURCES.filter((resource) => (permissions[resource]?.length ?? 0) > 0);
}

/** Does the role grant every action of this resource? */
export function grantsAll(permissions: Permissions, resource: Resource): boolean {
  return (permissions[resource]?.length ?? 0) === statement[resource].length;
}
