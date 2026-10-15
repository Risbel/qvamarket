/**
 * Storefront footer links (store.footer_links, jsonb). Groups of links, in display order:
 * the array order IS the position, so there is no index field to keep in sync.
 * Shared by the settings form, the server writes and the storefront read.
 */

export const MAX_FOOTER_GROUPS = 4;
export const MAX_FOOTER_LINKS = 8; // per group
export const FOOTER_TITLE_MAX = 40;
export const FOOTER_LABEL_MAX = 60;
export const FOOTER_URL_MAX = 500;
export const FOOTER_TEXT_MAX = 300; // the short text under the logo + name (store.footer_text)

export type FooterLink = { label: string; url: string; newTab: boolean };
export type FooterLinkGroup = { title: string; links: FooterLink[] };

/**
 * Only these destinations can reach the storefront: http(s) with a host, mailto:, tel:, or a
 * path on the store itself ("/..."). Everything else (javascript:, data:, "//evil.com",
 * backslashes) is refused, because the URL ends up in an href on every storefront page.
 */
export function isSafeLinkUrl(url: string): boolean {
  if (url.length === 0 || url.length > FOOTER_URL_MAX || /[\s\\]/.test(url)) return false;
  if (url.startsWith("/")) return !url.startsWith("//");
  if (/^mailto:[^@]+@[^@]+$/i.test(url)) return true;
  if (/^tel:\+?[0-9()-]{3,}$/i.test(url)) return true;
  if (!/^https?:\/\//i.test(url)) return false;
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname.includes(".");
  } catch {
    return false;
  }
}

/** "tienda.com/x" or "www.tienda.com" typed without a scheme becomes "https://...". */
export function normalizeLinkUrl(input: string): string {
  const url = input.trim();
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?([/?#].*)?$/i.test(url)) return `https://${url}`;
  return url;
}

/**
 * Reads the stored value defensively: anything malformed or unsafe is dropped (a link, or a
 * group left without links), never thrown. The database only checks that it is an array.
 */
export function parseFooterLinks(value: unknown): FooterLinkGroup[] {
  if (!Array.isArray(value)) return [];
  const groups: FooterLinkGroup[] = [];
  for (const group of value.slice(0, MAX_FOOTER_GROUPS)) {
    if (!group || typeof group !== "object") continue;
    const { title, links } = group as Record<string, unknown>;
    if (typeof title !== "string" || !Array.isArray(links)) continue;
    const safe: FooterLink[] = [];
    for (const link of links.slice(0, MAX_FOOTER_LINKS)) {
      if (!link || typeof link !== "object") continue;
      const { label, url, newTab } = link as Record<string, unknown>;
      if (typeof label !== "string" || label.trim() === "" || typeof url !== "string" || !isSafeLinkUrl(url)) continue;
      safe.push({ label: label.slice(0, FOOTER_LABEL_MAX), url, newTab: newTab === true });
    }
    if (safe.length > 0) groups.push({ title: title.slice(0, FOOTER_TITLE_MAX), links: safe });
  }
  return groups;
}
