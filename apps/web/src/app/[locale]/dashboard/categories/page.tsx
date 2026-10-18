import { getTranslations, setRequestLocale } from "next-intl/server";
import { listCategories } from "@/server/categories";
import { requirePanelSection } from "@/server/tenant";
import { CategoriesManager } from "./categories-manager";

export default async function CategoriesPage({
  params,
}: PageProps<"/[locale]/dashboard/categories">) {
  const { locale } = await params;
  setRequestLocale(locale);

  const merchant = await requirePanelSection(locale, "categories");
  const t = await getTranslations("Categories");
  const categories = await listCategories({ tenantId: merchant.tenantId, storeId: merchant.store.id });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-4">
      <div>
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      <CategoriesManager
        categories={categories}
        canCreate={merchant.can({ category: ["create"] })}
        canDelete={merchant.can({ category: ["delete"] })}
      />
    </div>
  );
}
