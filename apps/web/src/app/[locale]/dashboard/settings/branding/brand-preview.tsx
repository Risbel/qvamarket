import { readableForeground } from "@/lib/color";

/**
 * Mini storefront header + button + badge drawn with the chosen colors, so the merchant sees
 * the result (including the automatic text color) before saving. Pure presentation.
 */
export function BrandPreview({
  name,
  logoUrl,
  logotypeUrl,
  primary,
  accent,
  buttonLabel,
  badgeLabel,
}: {
  name: string;
  logoUrl: string | null;
  logotypeUrl: string | null;
  primary: string;
  accent: string;
  buttonLabel: string;
  badgeLabel: string;
}) {
  return (
    <div className="overflow-hidden rounded-lg border">
      <div
        className="flex items-center gap-3 px-4 py-3"
        style={{ backgroundColor: primary, color: readableForeground(primary) }}
      >
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
      <div className="flex items-center gap-3 p-4">
        <span
          className="rounded-md px-3 py-1.5 text-sm font-medium"
          style={{ backgroundColor: primary, color: readableForeground(primary) }}
        >
          {buttonLabel}
        </span>
        <span
          className="rounded-full px-2.5 py-0.5 text-xs font-medium"
          style={{ backgroundColor: accent, color: readableForeground(accent) }}
        >
          {badgeLabel}
        </span>
      </div>
    </div>
  );
}
