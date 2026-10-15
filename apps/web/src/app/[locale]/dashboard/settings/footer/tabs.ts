// Not in footer-tabs.tsx: a "use client" module cannot hand plain values to the server page.
export const FOOTER_TABS = ["about", "links"] as const;
export type FooterTab = (typeof FOOTER_TABS)[number];
