import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import type { FooterLinkGroup } from "@/lib/footer";
import { socialNetwork, type SocialLink } from "@/lib/social";
import { SocialIcon } from "@/components/social-icon";

/**
 * Storefront footer (Settings > Footer). Always shows the store's brand column: the logotype
 * alone when there is one (same rule as the header), otherwise logo + name, the merchant's
 * short text below (plain text, line breaks kept) and the social media icons (always a new tab;
 * URLs checked against each network's domains by parseFooterSocial). Then the link groups, in
 * their order. Their URLs were checked by parseFooterLinks (http(s), mailto:, tel: or a path on this store). Plain
 * <a> on purpose: a store path typed by the merchant ("/products/x") gets its locale from the proxy.
 */
export async function StoreFooter({
  name,
  logoUrl,
  logotypeUrl,
  text,
  groups,
  social,
}: {
  name: string;
  logoUrl: string | null;
  logotypeUrl: string | null;
  text: string | null;
  groups: FooterLinkGroup[];
  social: SocialLink[];
}) {
  const t = await getTranslations("Store.footer");

  return (
    <footer className="mt-auto border-t bg-muted/40">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-4 py-10 md:flex-row md:gap-12">
        <div className="flex max-w-sm flex-col gap-3 md:w-72 md:shrink-0">
          <Link href="/" className="flex w-fit min-w-0 items-center gap-3 rounded outline-offset-4 focus-visible:outline-2">
            {logotypeUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
              <img src={logotypeUrl} alt={name} className="h-10 w-auto max-w-64 object-contain object-left" />
            ) : (
              <>
                {logoUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
                  <img src={logoUrl} alt="" width={40} height={40} className="size-10 shrink-0 rounded object-contain" />
                )}
                <span className="truncate text-lg font-semibold">{name}</span>
              </>
            )}
          </Link>
          {text && <p className="text-sm whitespace-pre-line text-muted-foreground">{text}</p>}
          {social.length > 0 && (
            <ul aria-label={t("socialLabel")} className="-ml-2 flex flex-wrap gap-1">
              {social.map((link) => (
                <li key={link.network}>
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("social", { name: socialNetwork(link.network).name })}
                    className="flex size-9 items-center justify-center rounded-full text-muted-foreground outline-offset-2 hover:bg-muted hover:text-foreground focus-visible:outline-2"
                  >
                    <SocialIcon network={link.network} />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>

        {groups.length > 0 && (
          <nav
            aria-label={t("label")}
            className="grid flex-1 grid-cols-2 gap-8 sm:grid-cols-[repeat(auto-fit,minmax(10rem,1fr))]"
          >
            {groups.map((group, index) => (
              <section key={index} aria-labelledby={`footer-group-${index}`} className="flex flex-col gap-3">
                <h2 id={`footer-group-${index}`} className="text-sm font-semibold tracking-wide uppercase">
                  {group.title}
                </h2>
                <ul className="flex flex-col gap-2 text-sm">
                  {group.links.map((link, linkIndex) => (
                    <li key={linkIndex}>
                      <a
                        href={link.url}
                        {...(link.newTab ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                        className="text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                      >
                        {link.label}
                        {link.newTab && <span className="sr-only"> {t("newTab")}</span>}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </nav>
        )}
      </div>
    </footer>
  );
}
