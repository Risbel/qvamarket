import { and, db, eq, store } from "@qvashop/db";
import { parseFooterLinks, type FooterLinkGroup } from "@/lib/footer";
import { parseFooterSocial, type SocialLink } from "@/lib/social";
import type { PickupValues, StoreProfileValues } from "@/lib/validation/catalog-settings";
import type { FooterLinksValues, FooterSocialValues, FooterTextValues } from "@/lib/validation/footer";

type Scope = { tenantId: string; storeId: string };
const owns = ({ tenantId, storeId }: Scope) => and(eq(store.id, storeId), eq(store.tenantId, tenantId));

export async function getStoreProfile(scope: Scope) {
  const [row] = await db
    .select({
      description: store.description,
      phone: store.phone,
      whatsapp: store.whatsapp,
      contactEmail: store.contactEmail,
      address: store.address,
      phoneCountry: store.phoneCountry,
      pickupInstructions: store.pickupInstructions,
      metaTitle: store.metaTitle,
      metaDescription: store.metaDescription,
    })
    .from(store)
    .where(owns(scope))
    .limit(1);
  return row ?? null;
}

const orNull = (value: string) => (value === "" ? null : value);

/** Saves the public profile; empty fields are stored as NULL. */
export async function updateStoreProfile(scope: Scope, values: StoreProfileValues) {
  const rows = await db
    .update(store)
    .set({
      description: orNull(values.description),
      phone: orNull(values.phone),
      whatsapp: orNull(values.whatsapp),
      contactEmail: orNull(values.contactEmail),
      address: orNull(values.address),
      phoneCountry: orNull(values.phoneCountry),
      metaTitle: orNull(values.metaTitle),
      metaDescription: orNull(values.metaDescription),
    })
    .where(owns(scope))
    .returning({ id: store.id });
  return rows.length === 1;
}

/**
 * Footer settings: the short text, the link groups and the social media links, in display order
 * (unsafe or malformed links are dropped).
 */
export async function getFooterSettings(
  scope: Scope,
): Promise<{ text: string; groups: FooterLinkGroup[]; social: SocialLink[] }> {
  const [row] = await db
    .select({ footerText: store.footerText, footerLinks: store.footerLinks, footerSocial: store.footerSocial })
    .from(store)
    .where(owns(scope))
    .limit(1);
  return {
    text: row?.footerText ?? "",
    groups: parseFooterLinks(row?.footerLinks),
    social: parseFooterSocial(row?.footerSocial),
  };
}

/** Replaces the footer's social media links (validated values; array order = display order). None = NULL. */
export async function updateFooterSocial(scope: Scope, values: FooterSocialValues) {
  const links: SocialLink[] = values.links.map(({ network, url }) => ({ network, url }));
  const rows = await db
    .update(store)
    .set({ footerSocial: links.length > 0 ? links : null })
    .where(owns(scope))
    .returning({ id: store.id });
  return rows.length === 1;
}

/** Saves the footer's short text; empty = NULL. */
export async function updateFooterText(scope: Scope, values: FooterTextValues) {
  const rows = await db
    .update(store)
    .set({ footerText: orNull(values.footerText) })
    .where(owns(scope))
    .returning({ id: store.id });
  return rows.length === 1;
}

/** Replaces the footer links (validated values; array order = display order). None = NULL. */
export async function updateFooterLinks(scope: Scope, values: FooterLinksValues) {
  const groups: FooterLinkGroup[] = values.groups.map((group) => ({
    title: group.title,
    links: group.links.map(({ label, url, newTab }) => ({ label, url, newTab })),
  }));
  const rows = await db
    .update(store)
    .set({ footerLinks: groups.length > 0 ? groups : null })
    .where(owns(scope))
    .returning({ id: store.id });
  return rows.length === 1;
}

/** Saves the pickup settings; empty fields are stored as NULL. */
export async function updatePickupSettings(scope: Scope, values: PickupValues) {
  const rows = await db
    .update(store)
    .set({ pickupInstructions: orNull(values.pickupInstructions) })
    .where(owns(scope))
    .returning({ id: store.id });
  return rows.length === 1;
}
