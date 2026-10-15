import { isSafeLinkUrl } from "./footer";

/**
 * Custom store pages (store_page): "Sobre nosotros", "Envíos", "Preguntas frecuentes"...
 * served at <store>/<locale>/<slug>. Shared by the settings form, the server writes and the
 * storefront.
 */

export const MAX_STORE_PAGES = 20; // per store
export const PAGE_TITLE_MAX = 80;
export const PAGE_CONTENT_MAX = 20_000;
export const PAGE_STATUSES = ["draft", "published"] as const;
export type PageStatus = (typeof PAGE_STATUSES)[number];

/**
 * Page slugs live at the root of the store (/<locale>/<slug>), next to the storefront's own
 * routes, so those names (and a few the platform may need later) cannot be taken by a page.
 */
export const RESERVED_PAGE_SLUGS = [
  // storefront routes today
  "products",
  "cart",
  "checkout",
  "orders",
  "login",
  "signup",
  "account",
  // kept for the platform
  "api",
  "admin",
  "dashboard",
  "stores",
  "pages",
  "auth",
  "logout",
  "register",
  "search",
  "categories",
  "collections",
  "sitemap",
  "robots",
  "track",
  "wishlist",
] as const;

export function isReservedPageSlug(slug: string): boolean {
  return (RESERVED_PAGE_SLUGS as readonly string[]).includes(slug);
}

// ---------------------------------------------------------------------------------------
// Content: plain text with a few simple marks, turned into blocks that React renders.
// Never HTML: whatever the merchant types is shown as text, and links pass isSafeLinkUrl.
//
//   # Heading            ## Smaller heading      ### Smallest heading
//   --- (or *** / ___) alone on a line: a horizontal divider
//   - item / * item      1. numbered item
//   **bold**             [text](https://... or /products/...)      https://... (bare link)
//   a blank line starts a new paragraph; single line breaks are kept
// ---------------------------------------------------------------------------------------

export type PageInline =
  | { type: "text"; text: string }
  | { type: "bold"; text: string }
  | { type: "link"; text: string; url: string };

export type PageBlock =
  | { type: "heading"; level: 2 | 3 | 4; content: PageInline[] }
  | { type: "divider" }
  | { type: "paragraph"; lines: PageInline[][] }
  | { type: "list"; ordered: boolean; items: PageInline[][] };

const INLINE = /\*\*(.+?)\*\*|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()]+)/g;

/** Bold, [text](url) links and bare http(s) links; an unsafe link stays as plain text. */
export function parseInline(line: string): PageInline[] {
  const out: PageInline[] = [];
  const pushText = (text: string) => {
    if (!text) return;
    const last = out.at(-1);
    if (last?.type === "text") last.text += text;
    else out.push({ type: "text", text });
  };

  let cursor = 0;
  for (const match of line.matchAll(INLINE)) {
    const [whole, bold, label, url, bare] = match;
    pushText(line.slice(cursor, match.index));
    cursor = match.index + whole.length;
    if (bold !== undefined) {
      out.push({ type: "bold", text: bold });
    } else if (label !== undefined) {
      if (isSafeLinkUrl(url)) out.push({ type: "link", text: label, url });
      else pushText(whole);
    } else {
      // "Visit https://x.com." -> the final dot is punctuation, not part of the link
      const trimmed = bare.replace(/[.,;:!?]+$/, "");
      if (isSafeLinkUrl(trimmed)) out.push({ type: "link", text: trimmed, url: trimmed });
      else pushText(trimmed);
      pushText(bare.slice(trimmed.length));
    }
  }
  pushText(line.slice(cursor));
  return out;
}

// #, ## and ### (more #s, as Markdown allows, count as ###)
const HEADING = /^(#{1,6})\s+(.*)$/;
const DIVIDER = /^(?:-{3,}|\*{3,}|_{3,})$/;
const BULLET = /^[-*]\s+(.*)$/;
const NUMBERED = /^\d{1,3}[.)]\s+(.*)$/;

export function parsePageContent(content: string): PageBlock[] {
  const blocks: PageBlock[] = [];
  let paragraph: PageInline[][] | null = null;
  let list: Extract<PageBlock, { type: "list" }> | null = null;

  for (const raw of content.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trim();
    if (line === "") {
      paragraph = null;
      list = null;
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      const level = (Math.min(heading[1].length, 3) + 1) as 2 | 3 | 4;
      blocks.push({ type: "heading", level, content: parseInline(heading[2]) });
      paragraph = null;
      list = null;
      continue;
    }

    // Before the list check, so "---" or "***" does not become a list item
    if (DIVIDER.test(line)) {
      blocks.push({ type: "divider" });
      paragraph = null;
      list = null;
      continue;
    }

    const bullet = BULLET.exec(line);
    const numbered = bullet ? null : NUMBERED.exec(line);
    const item = bullet ?? numbered;
    if (item) {
      const ordered = numbered !== null;
      if (!list || list.ordered !== ordered) {
        list = { type: "list", ordered, items: [] };
        blocks.push(list);
      }
      list.items.push(parseInline(item[1]));
      paragraph = null;
      continue;
    }

    list = null;
    if (!paragraph) {
      paragraph = [];
      blocks.push({ type: "paragraph", lines: paragraph });
    }
    paragraph.push(parseInline(line));
  }
  return blocks;
}

/** Plain text of the content (marks removed), e.g. for a meta description fallback. */
export function pageContentText(content: string): string {
  return parsePageContent(content)
    .flatMap((block) => {
      if (block.type === "heading") return [block.content];
      if (block.type === "paragraph") return block.lines;
      if (block.type === "list") return block.items;
      return [];
    })
    .map((inlines) => inlines.map((inline) => inline.text).join(""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
