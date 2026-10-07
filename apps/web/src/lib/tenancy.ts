// Slugs merchants cannot use (see CLAUDE.md > Domains and routing)
export const RESERVED_SLUGS = [
  "www",
  "app",
  "admin",
  "api",
  "mail",
  "static",
  "assets",
  "status",
  "help",
  "docs",
] as const;

export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Returns the store slug for a `<slug>.<rootDomain>` host, or null when the
 * host is the root domain, a reserved subdomain (app, admin, ...), or anything else.
 */
export function getStoreSlug(
  host: string | null,
  rootDomain: string,
): string | null {
  if (!host) return null;

  const hostname = host.split(":")[0].toLowerCase();
  const suffix = `.${rootDomain.toLowerCase()}`;
  if (!hostname.endsWith(suffix)) return null;

  const slug = hostname.slice(0, -suffix.length);
  if (!SLUG_PATTERN.test(slug)) return null;
  if ((RESERVED_SLUGS as readonly string[]).includes(slug)) return null;

  return slug;
}

/** Public URL of a store, given the host the admin is currently using (keeps the dev port). */
export function buildStoreUrl(slug: string, requestHost: string | null): string {
  const [, port] = (requestHost ?? "").split(":");
  const isLocal = (process.env.ROOT_DOMAIN ?? "localhost") === "localhost";
  const root = process.env.ROOT_DOMAIN ?? "localhost";
  return `${isLocal ? "http" : "https"}://${slug}.${root}${port && isLocal ? `:${port}` : ""}`;
}
