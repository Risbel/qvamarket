import { getTranslations, setRequestLocale } from "next-intl/server";
import { BANNER_DEVICES } from "@/lib/images";
import { getSecondaryBannerVisible, listSecondaryPairs } from "@/server/secondary-banner";
import { listBannerImages } from "@/server/store-banner";
import { publicUrl } from "@/server/storage";
import { requirePanelSection } from "@/server/tenant";
import { SectionHeader } from "../section-header";
import { BannerImages } from "./banner-images";
import { BannerTabs } from "./banner-tabs";
import { SecondaryBannerPairs } from "./secondary-banner-pairs";
import { SecondaryBannerSwitch } from "./secondary-banner-switch";

/**
 * Banner settings, two tabs: the main banner (hero images, one list per device) and the
 * secondary banner (on/off switch + pairs of tiles per device). The secondary tab is locked
 * while the main banner has no images.
 */
export default async function BannerSettingsPage({
  params,
  searchParams,
}: PageProps<"/[locale]/dashboard/settings/banner">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, "settings");
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };
  const [t, hero, pairs, visible, { tab }] = await Promise.all([
    getTranslations("Banner"),
    listBannerImages(scope),
    listSecondaryPairs(scope),
    getSecondaryBannerVisible(scope),
    searchParams,
  ]);
  const secondaryLocked = hero.length === 0;
  const image = (key: string | null, size: number | null) =>
    key && size ? { url: publicUrl(key), sizeBytes: size } : null;

  return (
    <>
      <SectionHeader title={t("title")} description={t("description")} />
      <BannerTabs
        defaultTab={tab === "secondary" && !secondaryLocked ? "secondary" : "main"}
        secondaryLocked={secondaryLocked}
        main={
          <div className="flex flex-col gap-10">
            <p className="text-sm text-muted-foreground">{t("mainIntro")}</p>
            {BANNER_DEVICES.map((device) => (
              <BannerImages
                key={device}
                device={device}
                images={hero
                  .filter((h) => h.device === device)
                  .map((h) => ({ id: h.id, url: publicUrl(h.storageKey), sizeBytes: h.sizeBytes }))}
              />
            ))}
          </div>
        }
        secondary={
          !secondaryLocked && (
            <div className="flex flex-col gap-10">
              <div className="flex flex-col gap-4">
                <p className="text-sm text-muted-foreground">{t("secondary.description")}</p>
                <SecondaryBannerSwitch visible={visible} />
              </div>
              {BANNER_DEVICES.map((device) => (
                <SecondaryBannerPairs
                  key={device}
                  device={device}
                  heroMissing={!hero.some((h) => h.device === device)}
                  pairs={pairs
                    .filter((pair) => pair.device === device)
                    .map((pair) => ({
                      id: pair.id,
                      left: image(pair.leftStorageKey, pair.leftSizeBytes),
                      right: image(pair.rightStorageKey, pair.rightSizeBytes),
                    }))}
                />
              ))}
            </div>
          )
        }
      />
    </>
  );
}
