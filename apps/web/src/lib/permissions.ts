/**
 * Permissions = resource + action. This is the single place where they are defined.
 * Adding a feature: add its resource/actions here, grant them in the presets below that
 * should have them, and add the `Roles.resources.<resource>` messages.
 *
 * Roles: `owner` is built in (everything, cannot be edited). Every other role is a
 * `company_role` row of the company (seeded from ROLE_PRESETS, editable), and
 * `member.role` holds its key. Feature code checks permissions (`can`), never role names.
 *
 * Client-safe and pure: the panel's <PermissionsProvider> uses the same functions.
 */
export const statement = {
  store: ["read", "update"],
  product: ["read", "create", "update", "delete"],
  category: ["read", "create", "update", "delete"],
  // price lists: dated sales and special prices
  promotion: ["read", "create", "update", "delete"],
  // stock levels, unit costs and stock movements; update = adjust stock, edit costs
  inventory: ["read", "update"],
  // update = move the status forward; cancel is separate (it gives stock back); edit = lower
  // or remove items after checkout
  order: ["read", "update", "cancel", "edit"],
  // manual payments and refunds recorded on an order
  payment: ["read", "create", "delete"],
  // sell at the counter (point of sale): the sale is an order with its payments
  pos: ["create"],
  // the company's customers who ordered in the store (contact, orders, amount spent)
  customer: ["read"],
  // business totals: sales and money collected (income summary on the store home)
  report: ["read"],
  // money the store paid out: salaries, rent, utilities...
  expense: ["read", "create", "update", "delete"],
  // the cash register (day close), one shift per cashier: read = your shifts and their Z reports;
  // create = open your shift and record cash in / out; update = close it (count the cash);
  // supervise = every cashier's shifts and reports, the cash each drawer should hold, and closing
  // a shift on its cashier's behalf
  register: ["read", "create", "update", "supervise"],
  // the company's members (add, change role, reset password, remove)
  team: ["read", "create", "update", "delete"],
  // the company's roles
  role: ["read", "create", "update", "delete"],
} as const;

export type Resource = keyof typeof statement;
export type Action<R extends Resource = Resource> = (typeof statement)[R][number];

/** What a role grants: per resource, the actions allowed. */
export type Permissions = { [R in Resource]?: readonly Action<R>[] };
/** What a check asks for: every listed action must be granted. */
export type PermissionRequest = Permissions;

export const RESOURCES = Object.keys(statement) as Resource[];
/** Every action of any resource, in display order (the role editor's columns). */
export const ACTIONS = ["read", "create", "update", "delete", "cancel", "edit", "supervise"] as const satisfies readonly Action[];

/** The built-in role with every permission; never stored as a company_role. */
export const OWNER_ROLE = "owner";

export const OWNER_PERMISSIONS: Permissions = Object.fromEntries(
  RESOURCES.map((resource) => [resource, [...statement[resource]]]),
);

function isResource(value: string): value is Resource {
  return Object.hasOwn(statement, value);
}

function actionsOf(resource: Resource): readonly string[] {
  return statement[resource];
}

/** Does `granted` include every action of `request`? An empty request is always allowed. */
export function hasPermissions(granted: Permissions, request: PermissionRequest): boolean {
  return Object.entries(request).every(([resource, actions]) => {
    if (!isResource(resource)) return false;
    const allowed: readonly string[] = granted[resource] ?? [];
    return ((actions ?? []) as readonly string[]).every((action) => allowed.includes(action));
  });
}

/**
 * Cleans a permissions object from any source (form, database): unknown resources and
 * actions are dropped, actions keep the statement order, and any write action brings
 * `read` with it (you cannot edit what you cannot see). Empty resources are left out.
 */
export function normalizePermissions(input: unknown): Permissions {
  const result: Record<string, string[]> = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return result;
  for (const [resource, actions] of Object.entries(input)) {
    if (!isResource(resource) || !Array.isArray(actions)) continue;
    const known = actionsOf(resource);
    const picked = new Set(actions.filter((a): a is string => typeof a === "string" && known.includes(a)));
    if (picked.size > 0 && known.includes("read")) picked.add("read");
    const ordered = known.filter((action) => picked.has(action));
    if (ordered.length > 0) result[resource] = ordered;
  }
  return result as Permissions;
}

/** Union of several roles' permissions (a member can hold "manager,cashier"). */
export function mergePermissions(list: Permissions[]): Permissions {
  return normalizePermissions(
    Object.fromEntries(
      RESOURCES.map((resource) => [resource, list.flatMap((permissions) => permissions[resource] ?? [])]),
    ),
  );
}

/** Role keys in a `member.role` string (Better Auth stores several comma-separated). */
export function roleKeys(roleString: string): string[] {
  return roleString
    .split(",")
    .map((role) => role.trim())
    .filter(Boolean);
}

export function isOwner(roleString: string): boolean {
  return roleKeys(roleString).includes(OWNER_ROLE);
}

// ---------------------------------------------------------------------------------------
// Presets: seeded into every new company as editable roles, and offered as templates
// when creating a role. Names and descriptions: `Roles.presets.<key>` messages.
// ---------------------------------------------------------------------------------------

export const ROLE_PRESETS = {
  /** Runs the shop: settings, catalog, orders, payments and expenses. Sees the team, cannot manage it. */
  manager: {
    store: ["read", "update"],
    product: ["read", "create", "update", "delete"],
    category: ["read", "create", "update", "delete"],
    promotion: ["read", "create", "update", "delete"],
    inventory: ["read", "update"],
    order: ["read", "update", "cancel", "edit"],
    payment: ["read", "create", "delete"],
    pos: ["create"],
    customer: ["read"],
    report: ["read"],
    expense: ["read", "create", "update", "delete"],
    register: ["read", "create", "update", "supervise"],
    team: ["read"],
  },
  /** Serves customers: processes and edits orders, takes payments; looks at the catalog. */
  cashier: {
    store: ["read"],
    product: ["read"],
    category: ["read"],
    promotion: ["read"],
    order: ["read", "update", "cancel", "edit"],
    payment: ["read", "create"],
    pos: ["create"],
    customer: ["read"],
    register: ["read", "create", "update"],
  },
  /** Keeps the catalog up to date: products, categories, promotions and stock. No orders. */
  catalog: {
    store: ["read"],
    product: ["read", "create", "update", "delete"],
    category: ["read", "create", "update", "delete"],
    promotion: ["read", "create", "update", "delete"],
    inventory: ["read", "update"],
  },
  /** Prepares and delivers orders: moves their status, sees whether they are paid. */
  dispatch: {
    order: ["read", "update"],
    payment: ["read"],
  },
  /** Looks at everything of the shop, changes nothing. */
  viewer: {
    store: ["read"],
    product: ["read"],
    category: ["read"],
    promotion: ["read"],
    inventory: ["read"],
    order: ["read"],
    payment: ["read"],
    customer: ["read"],
    report: ["read"],
    expense: ["read"],
    register: ["read"],
  },
} as const satisfies Record<string, Permissions>;

export type RolePresetKey = keyof typeof ROLE_PRESETS;
export const ROLE_PRESET_KEYS = Object.keys(ROLE_PRESETS) as RolePresetKey[];

export function presetPermissions(key: RolePresetKey): Permissions {
  return normalizePermissions(ROLE_PRESETS[key]);
}
