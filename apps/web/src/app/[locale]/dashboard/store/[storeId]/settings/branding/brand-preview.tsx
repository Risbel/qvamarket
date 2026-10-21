"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { buildStoreTheme, themeStyle, type StoreThemeInput, type ThemeVars } from "@/lib/store-theme";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * The storefront's look with the chosen theme, light and dark side by side, so the merchant
 * sees the result (including the automatic text colors) before saving. Real shadcn components
 * under the generated variables (an inline style), the same ones the storefront gets.
 */
export function BrandPreview({
  name,
  logoUrl,
  logotypeUrl,
  theme,
}: {
  name: string;
  logoUrl: string | null;
  logotypeUrl: string | null;
  theme: StoreThemeInput;
}) {
  const t = useTranslations("Branding.preview");
  const { primary, accent, radius, base, tinted } = theme;
  const built = useMemo(
    () => buildStoreTheme({ primary, accent, radius, base, tinted }),
    [primary, accent, radius, base, tinted],
  );

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <Panel label={t("light")} vars={built.light} dark={false} name={name} logoUrl={logoUrl} logotypeUrl={logotypeUrl} />
      <Panel label={t("dark")} vars={built.dark} dark name={name} logoUrl={logoUrl} logotypeUrl={logotypeUrl} />
    </div>
  );
}

function Panel({
  label,
  vars,
  dark,
  name,
  logoUrl,
  logotypeUrl,
}: {
  label: string;
  vars: ThemeVars;
  dark: boolean;
  name: string;
  logoUrl: string | null;
  logotypeUrl: string | null;
}) {
  const t = useTranslations("Branding.preview");
  return (
    <figure className="flex flex-col gap-1.5">
      <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
      {/* A short scrolling frame: the content passes under the header as on the storefront */}
      <div
        style={themeStyle(vars)}
        tabIndex={0}
        aria-label={t("scroll", { mode: label })}
        className={`${dark ? "dark scheme-dark" : "scheme-light"} h-72 overflow-y-auto overscroll-contain rounded-lg border bg-background text-foreground`}
      >
        {/* Same look as the storefront header (stores/[slug]/layout.tsx): the brand color,
            slightly see-through, blurring what scrolls under it */}
        <div className="sticky top-0 z-10 flex items-center gap-3 bg-(--brand)/80 px-4 py-3 text-(--brand-foreground) backdrop-blur-md backdrop-saturate-150">
          {logotypeUrl ? (
            // Same rule as the storefront header: the logotype replaces the logo + name
            // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
            <img src={logotypeUrl} alt={name} className="h-8 w-auto max-w-56 object-contain object-left" />
          ) : (
            <>
              {logoUrl && (
                // eslint-disable-next-line @next/next/no-img-element -- our own bucket, already compressed
                <img src={logoUrl} alt="" width={32} height={32} className="size-8 rounded object-contain" />
              )}
              <span className="font-semibold">{name}</span>
            </>
          )}
        </div>
        {/* inert: a picture of the store, not controls of this form */}
        <div className="flex flex-col gap-3 p-4" inert>
          <Card size="sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {t("product")}
                <Badge className="bg-(--brand-accent) text-(--brand-accent-foreground)">{t("badge")}</Badge>
              </CardTitle>
              <CardDescription>{t("description")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {/* Default size, like the storefront's buttons: shadcn caps the small sizes'
                  radius at 12px, so they would not show the largest radii */}
              <Button>{t("button")}</Button>
              <Button variant="secondary">{t("secondary")}</Button>
              <Button variant="outline">
                {t("outline")}
              </Button>
            </CardContent>
          </Card>
          <Input readOnly placeholder={t("input")} />
          {/* Colorful stand-ins for product photos, for the header's blur to show over */}
          <div className="grid grid-cols-2 gap-3" aria-hidden>
            <div className="aspect-video rounded-lg bg-linear-to-br from-(--brand-accent) to-primary" />
            <div className="aspect-video rounded-lg bg-linear-to-tr from-primary to-(--brand-accent)" />
          </div>
        </div>
      </div>
    </figure>
  );
}
