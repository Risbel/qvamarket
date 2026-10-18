// Which of the company's stores a team member can open (decided 2026-10, option A: one role
// per person + a list of stores). Pure and client-safe: the team UI and the server share it.

/** `all` = every store of the company, also future ones; otherwise only `storeIds`. */
export type StoreAccess = { all: true } | { all: false; storeIds: string[] };

export const ALL_STORES: StoreAccess = { all: true };

export function canOpenStore(access: StoreAccess, storeId: string): boolean {
  return access.all || access.storeIds.includes(storeId);
}

/**
 * Is `requested` within `granted`? (no escalation: you only give, or act on someone with,
 * access you have yourself). "All stores" is only within "all stores".
 */
export function accessWithin(granted: StoreAccess, requested: StoreAccess): boolean {
  if (granted.all) return true;
  return !requested.all && requested.storeIds.every((id) => granted.storeIds.includes(id));
}

/**
 * "All stores", or the names of the chosen stores among `stores` (the ones the viewer can
 * see; stores they cannot see are only counted, never named). `t` = Team.storeAccess.
 */
export function storeAccessLabel(
  access: { all: boolean; storeIds: string[] },
  stores: { id: string; name: string }[],
  t: (key: "all" | "none" | "others", values?: { count: number }) => string,
): string[] {
  if (access.all) return [t("all")];
  const names = stores.filter((s) => access.storeIds.includes(s.id)).map((s) => s.name);
  const hidden = access.storeIds.length - names.length;
  if (names.length === 0 && hidden === 0) return [t("none")];
  return hidden > 0 ? [...names, t("others", { count: hidden })] : names;
}
