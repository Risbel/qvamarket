import { isSafeLinkUrl } from "@/lib/footer";

/**
 * Social media icons of the storefront footer (store.footer_social, jsonb): one entry per
 * network, in display order (array order = position). Shared by the settings form, the server
 * writes and the storefront read.
 *
 * Icons: Tabler Icons outline (MIT), static files in public/icons/social/<key>.svg. Adding a
 * network = its SVG there + an entry here (+ nothing else: names are brand names, not translated).
 * `hosts`: the URL must be on one of these domains (or a subdomain), so a network's icon can
 * never point at some other site.
 */
export const SOCIAL_NETWORKS = [
  { key: "facebook", name: "Facebook", hosts: ["facebook.com", "fb.com", "fb.me"], placeholder: "https://facebook.com/mitienda" },
  { key: "instagram", name: "Instagram", hosts: ["instagram.com"], placeholder: "https://instagram.com/mitienda" },
  { key: "whatsapp", name: "WhatsApp", hosts: ["wa.me", "whatsapp.com"], placeholder: "https://wa.me/5355555555" },
  { key: "telegram", name: "Telegram", hosts: ["t.me", "telegram.me"], placeholder: "https://t.me/mitienda" },
  { key: "tiktok", name: "TikTok", hosts: ["tiktok.com"], placeholder: "https://tiktok.com/@mitienda" },
  { key: "x", name: "X", hosts: ["x.com", "twitter.com"], placeholder: "https://x.com/mitienda" },
  { key: "youtube", name: "YouTube", hosts: ["youtube.com", "youtu.be"], placeholder: "https://youtube.com/@mitienda" },
] as const;

export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number]["key"];
export type SocialLink = { network: SocialNetwork; url: string };

export const SOCIAL_NETWORK_KEYS = SOCIAL_NETWORKS.map((n) => n.key) as [SocialNetwork, ...SocialNetwork[]];

const byKey = new Map<string, (typeof SOCIAL_NETWORKS)[number]>(SOCIAL_NETWORKS.map((n) => [n.key, n]));

export function isSocialNetwork(value: unknown): value is SocialNetwork {
  return typeof value === "string" && byKey.has(value);
}

export function socialNetwork(key: SocialNetwork) {
  return byKey.get(key)!;
}

export function socialIconUrl(key: SocialNetwork): string {
  return `/icons/social/${key}.svg`;
}

/** https only, a safe link (see isSafeLinkUrl) and on one of the network's domains. */
export function isSocialUrl(key: SocialNetwork, url: string): boolean {
  const network = byKey.get(key);
  if (!network || !isSafeLinkUrl(url) || !/^https:\/\//i.test(url)) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return network.hosts.some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

/**
 * Reads the stored value defensively: unknown networks, repeated networks and bad URLs are
 * dropped, never thrown. The database only checks that it is an array.
 */
export function parseFooterSocial(value: unknown): SocialLink[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const links: SocialLink[] = [];
  for (const item of value.slice(0, SOCIAL_NETWORKS.length)) {
    if (!item || typeof item !== "object") continue;
    const { network, url } = item as Record<string, unknown>;
    if (!isSocialNetwork(network) || seen.has(network) || typeof url !== "string" || !isSocialUrl(network, url)) continue;
    seen.add(network);
    links.push({ network, url });
  }
  return links;
}
