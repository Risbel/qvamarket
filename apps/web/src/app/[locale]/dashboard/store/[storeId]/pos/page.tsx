import { BanknoteIcon } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { phoneCountryOptions } from "@/lib/countries";
import { storePath } from "@/lib/panel-paths";
import { buttonVariants } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { listPosCatalog } from "@/server/pos";
import { hasOpenShift } from "@/server/register";
import { publicUrl } from "@/server/storage";
import { requirePanelSection } from "@/server/tenant";
import { PosRoot } from "./pos-screen";

/**
 * Selling at the counter: the store's active products by category, a ticket and the charge.
 * On a plan with day close the seller needs their own open register shift first (the cash
 * goes to their drawer); otherwise sales have no shift.
 */
export default async function PosPage({ params }: PageProps<"/[locale]/dashboard/store/[storeId]/pos">) {
  const { locale, storeId } = await params;
  setRequestLocale(locale);
  const merchant = await requirePanelSection(locale, storeId, "pos");
  const t = await getTranslations("Pos");
  const scope = { tenantId: merchant.tenantId, storeId: merchant.store.id };

  if (merchant.hasFeature("dayClose") && !(await hasOpenShift(scope, merchant.session.user.id))) {
    const canOpen = merchant.can({ register: ["create"] });
    return (
      <div className="flex flex-1 items-center justify-center p-4">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BanknoteIcon />
            </EmptyMedia>
            <EmptyTitle>{t("noShift.title")}</EmptyTitle>
            <EmptyDescription>{t(canOpen ? "noShift.description" : "noShift.askPermission")}</EmptyDescription>
          </EmptyHeader>
          {canOpen && (
            <EmptyContent>
              <Link href={storePath(storeId, "/register")} className={buttonVariants()}>
                {t("noShift.open")}
              </Link>
            </EmptyContent>
          )}
        </Empty>
      </div>
    );
  }

  const catalog = await listPosCatalog(scope);
  const products = catalog.products.map(({ imageKey, ...p }) => ({ ...p, imageKey: null, imageUrl: imageKey ? publicUrl(imageKey) : null }));

  return (
    <PosRoot
      categories={catalog.categories}
      products={products}
      prices={catalog.prices}
      currencies={merchant.store.currencies.map((c) => ({ code: c.code, digits: c.digits }))}
      defaultCurrency={merchant.store.defaultCurrency.code}
      phoneCountries={phoneCountryOptions(locale)}
      phoneCountry={catalog.phoneCountry ?? ""}
    />
  );
}
