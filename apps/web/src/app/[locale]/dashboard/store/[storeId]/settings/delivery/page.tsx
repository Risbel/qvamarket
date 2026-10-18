import { getTranslations, setRequestLocale } from "next-intl/server";
import { minorToInput } from "@/lib/money";
import { getDeliverySettings } from "@/server/delivery-settings";
import { requirePanelSection } from "@/server/tenant";
import { PermissionFieldset } from "@/components/permissions/permission-fieldset";
import { SectionHeader } from "../section-header";
import { DeliveryAreaForm } from "./delivery-area-form";
import { DeliveryChargesForm } from "./delivery-charges-form";

export default async function DeliverySettingsPage({ params }: PageProps<"/[locale]/dashboard/store/[storeId]/settings/delivery">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, storeId, "settings");
  const t = await getTranslations("Settings.delivery");
  const settings = await getDeliverySettings({ tenantId: merchant.tenantId, storeId: merchant.store.id });
  const currencies = merchant.store.currencies;
  // Saved amounts back to the decimal strings the form edits ("" = not set)
  const asInput = (minor: number | null | undefined, digits: number) => (minor ? minorToInput(minor, digits) : "");

  return (
    <>
      <SectionHeader title={t("title")} description={t("description")} />
      <PermissionFieldset permission={{ store: ["update"] }}>
        <section className="flex flex-col gap-4" aria-labelledby="delivery-area-title">
          <h3 id="delivery-area-title" className="text-base font-semibold">
            {t("areaTitle")}
          </h3>
          <DeliveryAreaForm initialValues={{ location: settings.location, area: settings.area }} />
        </section>
        <section className="mt-10 flex flex-col gap-4 border-t pt-8" aria-labelledby="delivery-charges-title">
          <div className="flex flex-col gap-1">
            <h3 id="delivery-charges-title" className="text-base font-semibold">
              {t("charges.title")}
            </h3>
            <p className="text-sm text-muted-foreground">{t("charges.description")}</p>
          </div>
          <DeliveryChargesForm
            currencies={currencies}
            hasArea={settings.location !== null && settings.area.length >= 3}
            initialValues={{
              deliveryEnabled: settings.deliveryEnabled,
              pickupEnabled: settings.pickupEnabled,
              mode: settings.mode,
              baseDistanceKm: settings.baseDistanceM ? minorToInput(settings.baseDistanceM, 3).replace(/\.?0+$/, "") : "",
              rates: currencies.map((currency) => {
                const rate = settings.rates.get(currency.code);
                const fee = rate && settings.mode !== "free";
                return {
                  currency: currency.code,
                  // a fee of 0 is a real value in flat/distance mode: keep it visible
                  baseFee: fee ? minorToInput(rate.baseFeeMinor, currency.digits) : "",
                  perKm: fee && settings.mode === "distance" ? minorToInput(rate.perKmMinor, currency.digits) : "",
                  freeAbove: asInput(rate?.freeAboveMinor, currency.digits),
                  minOrder: asInput(rate?.minOrderMinor, currency.digits),
                };
              }),
            }}
          />
        </section>
      </PermissionFieldset>
    </>
  );
}
