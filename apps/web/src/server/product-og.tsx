import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import sharp, { type ResizeOptions } from "sharp";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, readableForeground } from "@/lib/color";
import { formatMoney } from "@/lib/money";
import type { ResolvedPrice } from "@/lib/pricing";
import type { PublicProduct } from "./public-catalog";
import { getObject } from "./storage";

export const OG_SIZE = { width: 1200, height: 630 } as const;
const PHOTO = OG_SIZE.height; // square photo on the left, full height
const PAD = 56;

type OgStore = {
  name: string;
  slug: string;
  logoKey: string | null;
  logotypeKey: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  defaultCurrency: { code: string };
};

/** What the card shows: the cheapest variant at 1 unit in the store's default currency. */
export function productCardPrice(product: PublicProduct): { price: ResolvedPrice; varies: boolean } | null {
  const prices = product.variants.flatMap((v) => (v.price ? [v.price] : []));
  if (prices.length === 0) return null; // not sold in that currency: no price on the card
  const price = prices.reduce((a, b) => (b.unitMinor < a.unitMinor ? b : a));
  return { price, varies: new Set(prices.map((p) => p.unitMinor)).size > 1 };
}

/**
 * Short hash of everything drawn on the card, added to its URL: WhatsApp / Facebook cache an
 * image by URL, so a new price, photo or logo gets a new URL (and the route can be cached long).
 */
export function productOgVersion(store: OgStore, product: PublicProduct, locale: string): string {
  const card = productCardPrice(product);
  return createHash("sha1")
    .update(
      JSON.stringify([
        locale,
        store.name,
        store.logoKey,
        store.logotypeKey,
        store.primaryColor,
        store.accentColor,
        store.defaultCurrency.code,
        product.name,
        product.imageKeys[0] ?? null,
        card?.price.unitMinor ?? null,
        card?.price.compareAtMinor ?? null,
        card?.varies ?? null,
      ]),
    )
    .digest("hex")
    .slice(0, 10);
}

// Satori cannot read woff2 (what next/font serves), so the card has its own TTF copies of Geist
let fonts: Promise<{ name: string; data: Buffer; weight: 400 | 600; style: "normal" }[]> | null = null;
function loadFonts() {
  fonts ??= Promise.all(
    ([["Geist-Regular.ttf", 400], ["Geist-SemiBold.ttf", 600]] as const).map(async ([file, weight]) => ({
      name: "Geist",
      data: await readFile(join(process.cwd(), "assets/fonts", file)),
      weight,
      style: "normal" as const,
    })),
  ).catch((error) => {
    fonts = null; // retry on the next request
    throw error;
  });
  return fonts;
}

/**
 * A stored image as a data URL Satori can draw: product images are WebP, which Satori does not
 * support, so sharp decodes and resizes them first. Null when the file is missing or unreadable.
 */
async function imageDataUrl(
  key: string | null,
  resize: ResizeOptions,
  format: "jpeg" | "png",
): Promise<string | null> {
  if (!key) return null;
  try {
    const bytes = await getObject(key);
    if (!bytes) return null;
    const image = sharp(bytes).resize(resize);
    const out = format === "jpeg" ? await image.jpeg({ quality: 90 }).toBuffer() : await image.png().toBuffer();
    return `data:image/${format};base64,${out.toString("base64")}`;
  } catch (error) {
    console.error("og image: could not read", key, error);
    return null;
  }
}

/**
 * Open Graph card of a product (1200 x 630 JPEG): photo on the left; store, name and price on
 * the right. JPEG because `ImageResponse` only makes PNG, and a photo PNG this size is often
 * over the ~300 KB WhatsApp accepts for a link preview.
 */
export async function renderProductOg(
  store: OgStore,
  product: PublicProduct,
  locale: string,
  labels: { from: string; sale: string; domain: string },
): Promise<Buffer> {
  const primary = store.primaryColor ?? DEFAULT_PRIMARY;
  const accent = store.accentColor ?? DEFAULT_ACCENT;
  const card = productCardPrice(product);
  const currency = store.defaultCurrency.code;

  const [photo, logotype, logo, fontData] = await Promise.all([
    imageDataUrl(product.imageKeys[0] ?? null, { width: PHOTO, height: PHOTO, fit: "cover" }, "jpeg"),
    imageDataUrl(store.logotypeKey, { height: 128, width: 900, fit: "inside" }, "png"),
    store.logotypeKey ? null : imageDataUrl(store.logoKey, { width: 128, height: 128, fit: "inside" }, "png"),
    loadFonts(),
  ]);

  const png = new ImageResponse(
    (
      <div style={{ display: "flex", width: "100%", height: "100%", background: "#ffffff", fontFamily: "Geist" }}>
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element -- Satori draws plain <img>
          <img src={photo} width={PHOTO} height={PHOTO} alt="" style={{ objectFit: "cover" }} />
        ) : (
          <div
            style={{
              display: "flex",
              width: PHOTO,
              height: PHOTO,
              alignItems: "center",
              justifyContent: "center",
              background: primary,
              color: readableForeground(primary),
              fontSize: 220,
              fontWeight: 600,
            }}
          >
            {product.name.trim().charAt(0).toUpperCase()}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: PAD, borderTop: `12px solid ${primary}` }}>
          {/* Store: the logotype alone when there is one (same rule as the storefront header) */}
          <div style={{ display: "flex", alignItems: "center", height: 64 }}>
            {logotype ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logotype} alt="" style={{ maxHeight: 64, maxWidth: OG_SIZE.width - PHOTO - PAD * 2, objectFit: "contain" }} />
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                {logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logo} width={64} height={64} alt="" style={{ borderRadius: 12, objectFit: "contain" }} />
                )}
                <div style={{ display: "block", fontSize: 32, fontWeight: 600, color: "#171717", lineClamp: 1, maxWidth: logo ? 376 : 458 }}>
                  {store.name}
                </div>
              </div>
            )}
          </div>

          <div
            style={{
              display: "block",
              marginTop: 48,
              fontSize: product.name.length > 60 ? 44 : 56,
              fontWeight: 600,
              lineHeight: 1.15,
              color: "#0a0a0a",
              lineClamp: 4,
            }}
          >
            {product.name}
          </div>

          <div style={{ display: "flex", flexDirection: "column", marginTop: "auto", gap: 10 }}>
            {card && (
              <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
                {card.price.compareAtMinor !== null && (
                  <div
                    style={{
                      display: "flex",
                      padding: "6px 16px",
                      borderRadius: 999,
                      background: accent,
                      color: readableForeground(accent),
                      fontSize: 24,
                      fontWeight: 600,
                    }}
                  >
                    {labels.sale}
                  </div>
                )}
                {card.price.compareAtMinor !== null && (
                  <div style={{ display: "flex", fontSize: 30, color: "#737373", textDecoration: "line-through" }}>
                    {formatMoney(card.price.compareAtMinor, currency, locale)}
                  </div>
                )}
              </div>
            )}
            {card && (
              <div style={{ display: "flex", alignItems: "baseline", gap: 14, color: "#0a0a0a" }}>
                {card.varies && <div style={{ display: "flex", fontSize: 30, color: "#525252" }}>{labels.from}</div>}
                <div style={{ display: "flex", fontSize: 64, fontWeight: 600 }}>
                  {formatMoney(card.price.unitMinor, currency, locale)}
                </div>
              </div>
            )}
            <div style={{ display: "flex", fontSize: 24, color: "#737373" }}>{labels.domain}</div>
          </div>
        </div>
      </div>
    ),
    { ...OG_SIZE, fonts: fontData },
  );

  return sharp(Buffer.from(await png.arrayBuffer())).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
}
